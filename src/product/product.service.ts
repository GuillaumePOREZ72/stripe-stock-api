import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

@Injectable()
export class ProductService {
  constructor(private prisma: PrismaService) {}

  async create(createProductDto: CreateProductDto) {
    const { prices, ...productData} = createProductDto;

    return this.prisma.product.create({
      data: {
        ...productData,
        prices: prices ? {
          create: prices
        } : undefined
      },
      include: {
        prices: true
      }
    });
  }

  async findAll() {
    return this.prisma.product.findMany({
      include: {
        prices: true
      }
    });
  }

  async findOne(id: number) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: {
        prices: true
      }
    });

    if (!product) {
      throw new NotFoundException(`Product with ID ${id} not found`);
    }

    return product;
  }

  async update(id: number, updateProductDto: UpdateProductDto) {
    const { prices, ...productData } = updateProductDto;

    const product = await this.prisma.product.findUnique({
      where: { id }
    });

    if (!product) {
      throw new NotFoundException(`Product with ID ${id} not found`)
    }

    return this.prisma.product.update({
      where: { id },
      data: {
        ...productData,
        prices: prices ? {
          create: prices
        } : undefined
      },
      include: {
        prices: true
      }
    })
  }

  async updateStock(id: number, stock: number) {
    const product = await this.prisma.product.findUnique({
      where: { id }
    });

    if (!product) {
      throw new NotFoundException(`Product with ID ${id} not found`);
    }

    return this.prisma.product.update({
      where: { id },
      data: { stock },
      include: {
        prices: true
      }
    });
  }

  async remove(id: number) {
    const product = await this.prisma.product.findUnique({
      where: { id }
    });

    if (!product) {
      throw new NotFoundException(`Product with ID ${id} not found`);
    }

    return this.prisma.product.delete({
      where: { id },
      include: {
        prices: true
      }
    });
  }
}
