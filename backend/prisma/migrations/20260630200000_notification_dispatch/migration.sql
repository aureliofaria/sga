-- Observabilidade do dispatcher de notificações externas (e-mail/Teams).
ALTER TABLE "Notification" ADD COLUMN "sentAt" DATETIME;
ALTER TABLE "Notification" ADD COLUMN "error" TEXT;
CREATE INDEX IF NOT EXISTS "Notification_channel_status_idx" ON "Notification"("channel", "status");
