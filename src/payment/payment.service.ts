import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common'; // Importez des exceptions simples
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service';
import { OrderStatus } from '@prisma/client';

@Injectable()
export class PaymentService {
  private stripe: Stripe;
  private successUrl: string;
  private cancelUrl: string;
  private webhookSecret: string;

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {
    this.stripe = new Stripe(this.configService.get<string>('STRIPE_SECRET_KEY') || '', {
      apiVersion: '2025-03-31.basil',
    });
    this.successUrl = this.configService.get<string>('STRIPE_SUCCESS_URL') || '';
    this.cancelUrl = this.configService.get<string>('STRIPE_CANCEL_URL') || '';
    this.webhookSecret = this.configService.get<string>('STRIPE_WEBHOOK_SECRET') || ''; // Récupérez le secret
  }

  // Créer une session de checkout
  async createCheckoutSession(items: { productId: number; quantity: number }[], customerId?: number) {
    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];
    
    for (const item of items) {
      const product = await this.prisma.product.findUnique({
        where: { id: item.productId },
        include: { prices: true }
      });
      
      if (!product) {
        throw new NotFoundException(`Product with ID ${item.productId} not found.`);
      }
      
      // Utiliser le prix de la base de données s'il existe, sinon créer un prix à la volée
      if (product.prices && product.prices.length > 0) {
        lineItems.push({
          price: product.prices[0].stripePriceId,
          quantity: item.quantity
        });
      } else {
        lineItems.push({
          price_data: {
            currency: 'eur',
            product_data: {
              name: product.name,
            },
            unit_amount: 2000, // 20.00 EUR
          },
          quantity: item.quantity,
        });
      }
    }
    
    // Options de base pour la session
    const sessionOptions: Stripe.Checkout.SessionCreateParams = {
      payment_method_types: ['card'],
      line_items: lineItems,
      mode: 'payment',
      success_url: `${process.env.STRIPE_SUCCESS_URL}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.STRIPE_CANCEL_URL}/cancel`,
    };
    
    // Ajouter le client si fourni
    if (customerId) {
      const customer = await this.prisma.customer.findUnique({
        where: { id: customerId }
      });
      
      if (customer && customer.stripeCustomerId) {
        sessionOptions.customer = customer.stripeCustomerId;
      }
    }
    
    const session = await this.stripe.checkout.sessions.create(sessionOptions);
    return session;
  }


  async handleWebhook(signature: string, rawBody: Buffer) {
    let event: Stripe.Event;

    try {
      event = this.stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
      console.log(`✅ Webhook validé: ${event.type}`);
    } catch (err) {
      console.error(`❌ Erreur de webhook: ${err.message}`);
      throw new BadRequestException(`Webhook Error: ${err.message}`);
    }

    // Traitement des événements de paiement
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      console.log(`💰 Paiement réussi! Session ID: ${session.id}`);
      
      try {
        // Récupérer les informations de la session
        const lineItems = await this.stripe.checkout.sessions.listLineItems(
          session.id,
          { limit: 100 }
        );
        
        // Récupérer le customerId depuis les métadonnées
        let customerId: number | undefined = undefined;
        if (session.metadata && session.metadata.customerId) {
          const parsedId = parseInt(session.metadata.customerId);
          if (!isNaN(parsedId)) {
            customerId = parsedId;
          }
        }
        
        // Préparer les items de commande
        const orderItems: Array<{
          productId: number;
          quantity: number;
          priceId: number;
          amount: number;
        }> = [];

        for (const item of lineItems.data) {
          const priceInDb = await this.prisma.price.findUnique({
            where: { stripePriceId: item.price?.id },
            include: { product: true }
          });
          
          if (priceInDb?.product) {
            orderItems.push({
              productId: priceInDb.product.id,
              quantity: item.quantity || 1,
              priceId: priceInDb.id,
              amount: item.amount_total ? item.amount_total / 100 : 0
          });
            
            // Mettre à jour le stock
            const newStock = Math.max(0, priceInDb.product.stock - (item.quantity || 0));
            await this.prisma.product.update({
              where: { id: priceInDb.product.id },
              data: { stock: newStock }
            });
            console.log(`✅ Stock mis à jour: ${priceInDb.product.name} → ${newStock}`);
          } else {
            console.log(`⚠️ Produit non trouvé pour le prix: ${item.price?.id}`);
          }
        }
        
        // Créer la commande dans la base de données
        const orderData = {
          stripeSessionId: session.id,
          status: 'COMPLETED' as OrderStatus,
          total: session.amount_total ? session.amount_total / 100 : 0,
          items: {
            create: orderItems
          }
        };
        
        // Ajouter customerId seulement s'il est défini
        if (customerId !== undefined) {
          orderData['customerId'] = customerId;
        }
        
        const order = await this.prisma.order.create({
          data: {
            ...orderData,
            customerId: customerId ?? 1
        }});
        
        console.log(`✅ Commande créée: #${order.id}`);
      } catch (error) {
        console.error(`❌ Erreur: ${error.message}`);
      }
    }
    
    // Traitement des événements de remboursement
    if (event.type === 'charge.refunded') {
      const charge = event.data.object as Stripe.Charge;
      console.log(`💸 Remboursement détecté pour la charge: ${charge.id}`);
    }
    
    if (event.type === 'refund.created') {
      const refund = event.data.object as Stripe.Refund;
      console.log(`✅ Remboursement créé: ${refund.id}`);
    }
    
    if (event.type === 'refund.updated') {
      const refund = event.data.object as Stripe.Refund;
      console.log(`🔄 Statut du remboursement mis à jour: ${refund.id} -> ${refund.status}`);
    }
    
    return { received: true };
  }

  
  async refundOrder(orderId: number, reason?: string) {
    console.log(`Demande de remboursement pour la commande #${orderId}`);
    
    // Récupérer les informations de la commande
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true }
    });

    if (!order) {
      console.log(`Commande #${orderId} non trouvée`);
      throw new NotFoundException(`Order with ID ${orderId} not found`);
    }

    console.log(`Commande trouvée: ${JSON.stringify(order)}`);

    if (order.status === 'REFUNDED') {
      console.log(`La commande #${orderId} a déjà été remboursée`);
      throw new BadRequestException('This order has already been refunded');
    }

    // Récupérer la session Stripe associée à la commande
    const stripeSessionId = order.stripeSessionId;
    if (!stripeSessionId) {
      console.log(`Pas de session Stripe associée à la commande #${orderId}`);
      throw new BadRequestException('No Stripe session associated with this order');
    }
    
    try {
      console.log(`Récupération de la session Stripe ${stripeSessionId}`);
      
      // Récupérer les informations de paiement de la session
      const session = await this.stripe.checkout.sessions.retrieve(stripeSessionId);
      
      if (!session.payment_intent) {
        console.log(`Pas de payment intent trouvé pour la session ${stripeSessionId}`);
        throw new BadRequestException('No payment intent found for this session');
      }
      
      // Récupérer le payment intent
      const paymentIntentId = typeof session.payment_intent === 'string' 
        ? session.payment_intent 
        : session.payment_intent.id;
      
      console.log(`Payment intent ID: ${paymentIntentId}`);
      
      // Créer le remboursement
      console.log(`Création du remboursement pour le payment intent ${paymentIntentId}`);
      const refund = await this.stripe.refunds.create({
        payment_intent: paymentIntentId,
        reason: (reason as 'duplicate' | 'fraudulent' | 'requested_by_customer') || 'requested_by_customer',
      });
      
      console.log(`Remboursement créé: ${refund.id}`);
      
      // Mettre à jour le statut de la commande
      console.log(`Mise à jour du statut de la commande #${orderId} à REFUNDED`);
      const updatedOrder = await this.prisma.order.update({
        where: { id: orderId },
        data: { status: 'REFUNDED' },
        include: { items: true }
      });
      
      // Remettre à jour le stock des produits
      console.log(`Mise à jour du stock pour les produits de la commande #${orderId}`);
      for (const item of order.items) {
        const product = await this.prisma.product.findUnique({
          where: { id: item.productId }
        });
        
        if (product) {
          const newStock = product.stock + item.quantity;
          console.log(`Mise à jour du stock pour le produit #${product.id}: ${product.stock} -> ${newStock}`);
          
          await this.prisma.product.update({
            where: { id: product.id },
            data: { stock: newStock }
          });
        }
      }
      
      console.log(`Remboursement terminé avec succès pour la commande #${orderId}`);
      return {
        success: true,
        order: updatedOrder,
        refund: refund
      };
    } catch (error) {
      console.error(`Erreur lors du remboursement de la commande #${orderId}:`, error);
      throw new BadRequestException(`Refund failed: ${error.message}`);
    }
  }
}
