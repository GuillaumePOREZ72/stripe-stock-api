import { Type } from 'class-transformer';
import { IsArray, IsNotEmpty, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';

// DTO simple pour un prix
class PriceInput {
  @IsString()
  @IsNotEmpty()
  stripePriceId: string;

  @IsString()
  @IsOptional()
  currency?: string;
}

export class CreateProductDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsNumber()
  @IsOptional()
  stock?: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PriceInput)
  prices: PriceInput[];
}