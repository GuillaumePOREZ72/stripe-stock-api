import { Type } from 'class-transformer';
import { IsString, IsNotEmpty, IsOptional, IsNumber, IsArray, ValidateNested, IsEnum,  } from 'class-validator';
import { OrderController } from '../order.controller';


    class OrderItemDto {
        @IsNumber()
        @IsNotEmpty()
        productId: number;

        @IsNumber()
        @IsNotEmpty()
        priceId: number;

        @IsNumber()
        @IsNotEmpty()
        quantity: number;

        @IsNumber()
        @IsNotEmpty()
        amount: number;

    }


    enum OrderStatus {
        PENDING = 'PENDING',
        COMPLETED = 'COMPLETED',
        CANCELLED = 'CANCELLED',
        REFUNDED = 'REFUNDED'

    }


export class CreateOrderDto {

    @IsString()
    @IsNotEmpty()
    stripeSessionId: string;

    @IsNumber()
    @IsNotEmpty()
    customerId: number;

    @IsEnum(OrderStatus)
    @IsNotEmpty()
    status: OrderStatus;

    @IsNumber()
    @IsNotEmpty()
    total: number;

    @IsString()
    @IsOptional()
    currency?: string;

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => OrderItemDto)
    items: OrderItemDto[];
}
