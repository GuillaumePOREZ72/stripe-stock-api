import { Controller, Get, Req, Res } from '@nestjs/common';
import { AppService } from './app.service';
import { Response, Request } from 'express';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('success')
  handleSuccess(@Req() req: Request, @Res() res: Response): void {
    console.log('Redirected to success page.');
    res.status(200).send('Payment successful! Your order is being processed.');
  }
}
