import {
  Injectable,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common'; // Importez des exceptions simples
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
    this.stripe = new Stripe(
      this.configService.get<string>('STRIPE_SECRET_KEY') || '',
      {
        apiVersion: '2025-03-31.basil',
      },
    );
    this.successUrl =
      this.configService.get<string>('STRIPE_SUCCESS_URL') || '';
    this.cancelUrl = this.configService.get<string>('STRIPE_CANCEL_URL') || '';
    this.webhookSecret =
      this.configService.get<string>('STRIPE_WEBHOOK_SECRET') || ''; // Récupérez le secret
  }

  // Créer une session de checkout
  async createCheckoutSession(items: any[], customerId?: number) {
    // Vérifier que items existe et est un tableau
    if (!items || !Array.isArray(items) || items.length === 0) {
       throw new BadRequestException('Items must be a non-empty array')
    }

    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];

    for (const item of items) {
      const product = await this.prisma.product.findUnique({
        where: { id: item.productId },
        include: { prices: true },
      });

      if (!product) {
        throw new NotFoundException(
          `Product with ID ${item.productId} not found.`,
        );
      }

      // Utiliser le prix de la base de données s'il existe, sinon créer un prix à la volée
      if (product.prices && product.prices.length > 0) {
        lineItems.push({
          price: product.prices[0].stripePriceId,
          quantity: item.quantity,
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
        where: { id: customerId },
      });

      if (customer && customer.stripeCustomerId) {
        sessionOptions.customer = customer.stripeCustomerId;
      }
    }

    const session = await this.stripe.checkout.sessions.create(sessionOptions);
    return session;
  }

  // Méthode pour les webhooks
  async handleWebhook(signature: string, rawBody: Buffer): Promise<{ received: true }> {
    const event = this.stripe.webhooks.constructEvent(
      rawBody,
      signature,
      this.webhookSecret,
    );

    switch (event.type) {
      case 'checkout.session.completed':
        const session = event.data.object as Stripe.Checkout.Session;

        const lineItems = await this.stripe.checkout.sessions.listLineItems(
          session.id,
          { limit: 100 },
        );

        const customerId = session.metadata?.customerId
          ? parseInt(session.metadata.customerId)
          : undefined;

        const orderItems = lineItems.data.flatMap((item) => {
          const priceInDb = this.prisma.price.findUnique({
            where: { stripePriceId: item.price?.id },
            include: { product: true },
          });

          if (!priceInDb || !priceInDb.product) {
            return [];
          }

          return {
            productId: priceInDb.product.id,
            quantity: item.quantity || 1,
            priceId: priceInDb.id,
            amount: item.amount_total ? item.amount_total / 100 : 0,
          };
        });

        // Mettre à jour le stock
        const productsToStockUpdate = orderItems.reduce<Record<number, number>>(
          (products, item) => {
            products[item.productId] = Math.max(
              0,
              (products[item.productId] || 0) - item.quantity,
            );
            return products;
          },
          {},
        );

        await this.prisma.product.updateMany({
          data: Object.entries(productsToStockUpdate).map(([productId, stock]) => ({
            id: parseInt(productId),
            stock,
          })),
        });

        // S'assurer que les informations du client sont à jour dans Stripe
        if (customerId !== undefined) {
          const customer = await this.prisma.customer.findUnique({
            where: { id: customerId },
          });

          if (customer && customer.stripeCustomerId) {
            await this.stripe.customers.update(customer.stripeCustomerId, {
              email: customer.email,
              name: customer.name || undefined,
              metadata: {
                customerId: customer.id.toString(),
              },
            });
          }
        }

        // Créer la commande dans la base de données
        const order = await this.prisma.order.create({
          data: {
            stripeSessionId: session.id,
            status: 'COMPLETED',
            total: session.amount_total ? session.amount_total / 100 : 0,
            items: {
              create: orderItems,
            },
            customerId,
          },
        });

        // Génère des factures et les envoie depuis Stripe
        await this.getInvoiceForOrder(order.id);

        break;

      case 'charge.refunded':
        const charge = event.data.object as Stripe.Charge;
        console.log(`Remboursement détecté pour la charge: ${charge.id}`);
        break;

      case 'refund.created':
        const refund = event.data.object as Stripe.Refund;
        console.log(`Remboursement créé: ${refund.id}`);
        break;

      case 'refund.updated':
        const updatedRefund = event.data.object as Stripe.Refund;
        console.log(
          `Statut du remboursement mis à jour: ${updatedRefund.id} -> ${updatedRefund.status}`,
        );
        break;

      default:
        console.log(`Événement inconnu: ${event.type}`);
        return { received: false };
    }

    return { received: true };
  }

  async refundOrder(orderId: number, reason?: string) {
    console.log(`Demande de remboursement pour la commande #${orderId}`);

    // Récupérer les informations de la commande
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true },
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
      throw new BadRequestException(
        'No Stripe session associated with this order',
      );
    }

    try {
      console.log(`Récupération de la session Stripe ${stripeSessionId}`);

      // Récupérer les informations de paiement de la session
      const session =
        await this.stripe.checkout.sessions.retrieve(stripeSessionId);

      if (!session.payment_intent) {
        console.log(
          `Pas de payment intent trouvé pour la session ${stripeSessionId}`,
        );
        throw new BadRequestException(
          'No payment intent found for this session',
        );
      }

      // Récupérer le payment intent
      const paymentIntentId =
        typeof session.payment_intent === 'string'
          ? session.payment_intent
          : session.payment_intent.id;

      console.log(`Payment intent ID: ${paymentIntentId}`);

      // Créer le remboursement
      console.log(
        `Création du remboursement pour le payment intent ${paymentIntentId}`,
      );
      const refund = await this.stripe.refunds.create({
        payment_intent: paymentIntentId,
        reason:
          (reason as 'duplicate' | 'fraudulent' | 'requested_by_customer') ||
          'requested_by_customer',
      });

      console.log(`Remboursement créé: ${refund.id}`);

      // Mettre à jour le statut de la commande
      console.log(
        `Mise à jour du statut de la commande #${orderId} à REFUNDED`,
      );
      const updatedOrder = await this.prisma.order.update({
        where: { id: orderId },
        data: { status: 'REFUNDED' },
        include: { items: true },
      });

      // Remettre à jour le stock des produits
      console.log(
        `Mise à jour du stock pour les produits de la commande #${orderId}`,
      );
      for (const item of order.items) {
        const product = await this.prisma.product.findUnique({
          where: { id: item.productId },
        });

        if (product) {
          const newStock = product.stock + item.quantity;
          console.log(
            `Mise à jour du stock pour le produit #${product.id}: ${product.stock} -> ${newStock}`,
          );

          await this.prisma.product.update({
            where: { id: product.id },
            data: { stock: newStock },
          });
        }
      }

      console.log(
        `Remboursement terminé avec succès pour la commande #${orderId}`,
      );
      return {
        success: true,
        order: updatedOrder,
        refund: refund,
      };
    } catch (error) {
      console.error(
        `Erreur lors du remboursement de la commande #${orderId}:`,
        error,
      );
      throw new BadRequestException(`Refund failed: ${error.message}`);
    }
  }

  async getInvoiceForOrder(orderId: number) {
    try {
      // Récupérer la commande avec tous les détails nécessaires
      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        include: { 
          items: {
            include: {
              product: true
            }
          },
          customer: true
        }
      });
      
      if (!order) {
        throw new NotFoundException(`Order with ID ${orderId} not found`);
      }
      
      // Si une facture existe déjà, la supprimer pour en créer une nouvelle
      if (order.stripeInvoiceId) {
        try {
          await this.stripe.invoices.del(order.stripeInvoiceId);
          console.log(`Facture existante ${order.stripeInvoiceId} supprimée`);
        } catch (error) {
          console.log(`Impossible de supprimer la facture: ${error.message}`);
        }
      }
      
      // Vérifier que le client existe dans Stripe
      if (!order.customer?.stripeCustomerId) {
        throw new BadRequestException('Customer has no Stripe ID');
      }
      
      // Vérifier que la commande a des articles
      if (!order.items || order.items.length === 0) {
        throw new BadRequestException('Order has no items');
      }
      
      console.log(`Création d'une nouvelle facture pour la commande ${orderId}`);
      
      // 1. Créer un brouillon de facture
      const invoice = await this.stripe.invoices.create({
        customer: order.customer.stripeCustomerId,
        auto_advance: false,
        collection_method: 'send_invoice', 
        days_until_due: 30,
        metadata: { 
          orderId: orderId.toString(),
          orderTotal: order.total.toString()
        },
        custom_fields: [
          {
            name: 'Numéro de commande',
            value: `#${orderId}`
          }
        ]
      });
      
      console.log(`Brouillon de facture créé: ${invoice.id}`);
      
      // 2. Ajouter les articles à la facture
      for (const item of order.items) {
        const productName = item.product ? item.product.name : `Produit #${item.productId}`;
        
        // Récupérer le prix Stripe associé au produit
        const priceData = await this.prisma.price.findFirst({
          where: { productId: item.productId },
        });
        
        if (!priceData || !priceData.stripePriceId) {
          throw new BadRequestException(`No Stripe price found for product: ${productName}`);
        }
        
        console.log(`Ajout de l'article: ${productName}, ${item.quantity} x prix Stripe: ${priceData.stripePriceId}`);
        
        await this.stripe.invoiceItems.create({
          invoice: invoice.id,
          customer: order.customer.stripeCustomerId,
          quantity: item.quantity,
          pricing: {
            price: priceData.stripePriceId,
          }
        });
      }
      
      // 3. Attendre que les éléments soient bien enregistrés
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // 4. Vérifier que les éléments ont été ajoutés
      const invoiceItems = await this.stripe.invoiceItems.list({
        invoice: invoice.id
      });
      
      console.log(`${invoiceItems.data.length} éléments ajoutés à la facture ${invoice.id}`);
      
      if (invoiceItems.data.length === 0) {
        throw new Error('Aucun élément n\'a été ajouté à la facture');
      }
      
      // 5. Finaliser la facture
      if (!invoice.id) {
        throw new Error('Invoice ID is undefined');
      }
      const finalizedInvoice = await this.stripe.invoices.finalizeInvoice(invoice.id);
      console.log(`Facture finalisée: ${finalizedInvoice.id}`);
      
      // 6. Mettre à jour l'ID de facture dans la base de données
      await this.prisma.order.update({
        where: { id: orderId },
        data: { stripeInvoiceId: finalizedInvoice.id },
      });
      
      return finalizedInvoice;
    } catch (error) {
      console.error(`Erreur lors de la création de la facture: ${error.message}`);
      throw new InternalServerErrorException(`Failed to create invoice: ${error.message}`);
    }
  }
}
