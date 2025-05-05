// src/payment/payment.controller.ts
import { Controller, Post, Body, Headers, Req, Res, HttpStatus, Param } from '@nestjs/common';
import { PaymentService } from './payment.service';
import { Response } from 'express'; // Importez seulement Response
import { RawBodyRequest } from '@nestjs/common'; // Pour le type rawBody
import { Request } from 'express'; // Pour le type Request (utilisé avec RawBodyRequest)
import { CreateCheckoutSessionDto } from './dto/create.checkoutSession.dto';



@Controller('payment')
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  // Endpoint pour créer une session
  @Post('create-checkout-session')
  async createCheckoutSession(@Body() createCheckoutSessionDto: CreateCheckoutSessionDto) {
    try {

       // Vérifier que items existe et est un tableau
      if (!createCheckoutSessionDto.items || !Array.isArray(createCheckoutSessionDto.items) || createCheckoutSessionDto.items.length ===  0) {
      return { 
        error: "Items must be a non-empty array", 
        statusCode: HttpStatus.BAD_REQUEST 
      };
    }
      const session = await this.paymentService.createCheckoutSession(createCheckoutSessionDto.items, createCheckoutSessionDto.customerId);
      // On retourne l'URL Stripe
      return { url: session.url };
    } catch (error) {
      console.error('Error creating checkout session:', error);
       const statusCode = error.status || HttpStatus.INTERNAL_SERVER_ERROR;
      return { error: error.message, statusCode: statusCode };
    }
  }

  // Endpoint pour le webhook Stripe
  @Post('webhook')
  async handleWebhook(@Req() req: RawBodyRequest<Request>, @Res() res: Response, @Headers('stripe-signature') signature: string) {

     // req.rawBody est disponible grâce à la configuration dans main.ts
    const rawBody = req.rawBody;

     if (!rawBody) {
        console.error('Webhook received without raw body');
        return res.status(HttpStatus.BAD_REQUEST).send('Webhook Error: Missing raw body');
     }

    if (!signature) {
        console.error('Webhook received without signature header');
        return res.status(HttpStatus.BAD_REQUEST).send('Webhook Error: Missing stripe-signature header');
    }

      // Logger le corps brut de la requête (en tant que chaîne)
    console.log('Raw webhook payload:');
    console.log(rawBody.toString('utf8'));
    
    try {
      // Appeler le service pour traiter
      await this.paymentService.handleWebhook(signature, rawBody);
      res.status(HttpStatus.OK).send({ received: true });

    } catch (error) {
      console.error('Error processing webhook:', error.message);
      res.status(HttpStatus.BAD_REQUEST).send(`Webhook Error: ${error.message}`);
    }
  }

  @Post('refund/:orderId')
  async refundOrder(@Param('orderId') orderId: string, @Body('reason') reason?: string) {
    return this.paymentService.refundOrder(+orderId, reason);
  }
}