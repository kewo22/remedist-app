import { Global, Injectable, Module } from '@nestjs/common';
import { DatabaseService, Queryable } from '../../database/database.service';

// Matches the CHECKs on public.notifications. Keep in step with the migration.
export type NotificationSection =
  | 'pipeline'
  | 'bookings'
  | 'payments'
  | 'reviews'
  | 'accounts'
  | 'availability'
  | 'products'
  | 'faq'
  | 'probono';
export type NotificationType =
  | 'new_lead'
  | 'new_booking'
  | 'reschedule'
  | 'cancellation'
  | 'no_show'
  | 'payment_received'
  | 'overdue_payment'
  | 'pay_after_review'
  | 'new_testimonial'
  | 'new_signup'
  | 'calendar_conflict'
  | 'low_stock'
  | 'probono_reclaim_eligible'
  | 'scheduled'
  | 'possible_faq_gap';
export type NotificationSeverity = 'critical' | 'warning' | 'success' | 'info' | 'neutral';

export interface NewNotification {
  section: NotificationSection;
  type: NotificationType;
  message: string;
  severity: NotificationSeverity;
  entityType?: string;
  entityId?: string;
  /** Only holders of this role see it; omit for every staff member. */
  targetRole?: string;
}

/**
 * Writes the staff notification feed (the CRM badges). Reading and dismissing belong to the CRM
 * notifications task. Never put clinical text in a message.
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly db: DatabaseService) {}

  async notify(notification: NewNotification, db: Queryable = this.db): Promise<void> {
    await db.query(
      `INSERT INTO notifications (section, type, severity, message, entity_type, entity_id, target_role)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        notification.section,
        notification.type,
        notification.severity,
        notification.message,
        notification.entityType ?? null,
        notification.entityId ?? null,
        notification.targetRole ?? null,
      ],
    );
  }
}

@Global()
@Module({ providers: [NotificationsService], exports: [NotificationsService] })
export class NotificationsModule {}
