import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';

@Injectable()
export class OrderService {
  constructor(private prisma: PrismaService) {}


  async create(createOrderDto: CreateOrderDto) {
    const { items, ...orderData} = createOrderDto;

    const existingOrder = await this.prisma.order.findUnique({
      where: { stripeSessionId: orderData.stripeSessionId }
    });

    if (existingOrder) {
      throw new Error(`Order with stripSessionId ${orderData.stripeSessionId} already exists.`)
    }

    return this.prisma.$transaction(async (prisma) => {
      const order = await prisma.order.create({
        data: {
          ...orderData,
          items: {
            create: items.map(item => ({
              productId: item.productId,
              priceId: item.priceId,
              quantity: item.quantity,
              amount: item.amount
            }))
          }
        },
        include: {
          items: true,
          customer: true
        }
      });

      return order;
    })
  }

  async findAll() {
    return this.prisma.order.findMany({
      include: {
        items: true,
        customer: true
      }
    });
  }

  async findOne(id: number) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        items: true,
        customer: true
      }
    });

    if (!order) {
      throw new NotFoundException(`Order with ID ${id} not found`)
    }

    return order;
  }

  async findByStripeSessionId(stripeSessionId: string) {
    return this.prisma.order.findUnique({
      where: { stripeSessionId },
      include: {
        items: true,
        customer: true
      }
    });
  }

  async findByCustomerId(customerId: number) {
    return this.prisma.order.findMany({
      where: { customerId },
      include: {
        items: true
      }
    });
  }

  async update(id: number, updateOrderDto: UpdateOrderDto) {
    const order = await this.prisma.order.findUnique({
      where: { id }
    });

    if (!order) {
      throw new NotFoundException(`Order with ID ${id} not found`)
    }

    return this.prisma.order.update({
      where: { id },
      data: {
        ...updateOrderDto,
        items: updateOrderDto.items ? {
          updateMany: updateOrderDto.items.map(item => ({
            where: { 
              orderId: id,
              productId: item.productId 
            },
            data: {
              quantity: item.quantity,
              amount: item.amount
            }
          }))
        } : undefined
      },
      include: {
        items: true,
        customer: true
      }
    })
  }

  async updateStatus(id: number, status: string) {
    const order = await this.prisma.order.findUnique({
      where: { id }
    });

    if (!order) {
      throw new NotFoundException(`Order with ID ${id} not found`);
    }

    return this.prisma.order.update({
      where: { id },
      data: { status: status as any },
      include: {
        items: true,
        customer: true
      }
    })
  }

  async remove(id: number) {
    const order = await this.prisma.order.findUnique({
      where: { id }
    });
  }
}
