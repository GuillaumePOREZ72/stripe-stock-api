import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

@Injectable()
export class CustomerService {
  constructor(private prisma: PrismaService) {}


  async create(createCustomerDto: CreateCustomerDto) {
    return this.prisma.customer.create({
      data: createCustomerDto,
    });
  }

  async findAll() {
    return this.prisma.customer.findMany();
  }

  async findOne(id: number) {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
    });

    if (!customer) {
      throw new NotFoundException(`Customer with ID ${id} not found`)
    }

    return customer
  }

  async findByEmail(email: string) {
    return this.prisma.customer.findUnique({
      where: { email },
    })
  }

  async findByStripeId(stripeCustomerId: string) {
    return this.prisma.customer.findUnique({
      where: { stripeCustomerId },
    })
  }

  async update(id: number, updateCustomerDto: UpdateCustomerDto) {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
    })
    
    if (!customer) {
      throw new NotFoundException(`Customer with ID ${id} not found`)
    }

    return this.prisma.customer.update({
      where: { id },
      data: updateCustomerDto,
    })
  }

  async remove(id: number) {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
    });
    
    if (!customer) {
      throw new NotFoundException(`Customer with ID ${id} not found`);
    }
    
    return this.prisma.customer.delete({
      where: { id },
    });
  }
}
