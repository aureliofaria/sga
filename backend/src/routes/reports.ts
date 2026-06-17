import { Router, Request as ExpressRequest, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { authenticate, requireRole } from '../middleware/auth';

const router = Router();

const STATUSES = ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'REJECTED', 'CANCELLED'] as const;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Resolves the reporting window from query params; defaults to the last 30 days. */
function parseRange(query: ExpressRequest['query']): { from: Date; to: Date } {
  let to = typeof query.to === 'string' ? new Date(query.to) : new Date();
  if (isNaN(to.getTime())) to = new Date();
  let from = typeof query.from === 'string' ? new Date(query.from) : new Date(to.getTime() - 29 * DAY_MS);
  if (isNaN(from.getTime())) from = new Date(to.getTime() - 29 * DAY_MS);
  if (from > to) [from, to] = [to, from];
  return { from, to };
}

const dateKey = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * Visibilidade e relatórios (Prioridade 4) — métricas agregadas de SLA e volume.
 * Restrito a papéis de gestão (ADMIN/DIRETOR/MANAGER). Apenas leitura; nenhuma
 * alteração de schema. Agregação feita em memória (escala de desenvolvimento).
 */
router.get(
  '/dashboard',
  authenticate,
  requireRole('ADMIN', 'DIRETOR', 'MANAGER'),
  async (req: ExpressRequest, res: Response) => {
    try {
      const { from, to } = parseRange(req.query);
      const flowType =
        typeof req.query.flowType === 'string' && req.query.flowType ? req.query.flowType : undefined;

      const requestWhere: Prisma.RequestWhereInput = {
        createdAt: { gte: from, lte: to },
        ...(flowType ? { flow: { is: { type: flowType } } } : {}),
      };

      const [requests, tasks, completedLogs] = await Promise.all([
        prisma.request.findMany({
          where: requestWhere,
          select: { status: true, createdAt: true, flow: { select: { type: true, name: true } } },
        }),
        prisma.requestTask.findMany({
          where: { request: requestWhere },
          select: { status: true, dueDate: true, completedAt: true, createdAt: true },
        }),
        prisma.auditLog.findMany({
          where: { action: 'COMPLETED', createdAt: { gte: from, lte: to }, ...(flowType ? { request: { flow: { is: { type: flowType } } } } : {}) },
          select: { createdAt: true },
        }),
      ]);

      // --- Status counts ---
      const statusCounts: Record<string, number> = Object.fromEntries(STATUSES.map((s) => [s, 0]));
      const flowMap = new Map<string, { type: string; name: string; count: number }>();
      for (const r of requests) {
        statusCounts[r.status] = (statusCounts[r.status] ?? 0) + 1;
        const key = r.flow.type;
        const entry = flowMap.get(key) ?? { type: r.flow.type, name: r.flow.name, count: 0 };
        entry.count += 1;
        flowMap.set(key, entry);
      }
      const totalRequests = requests.length;
      const openRequests = (statusCounts.PENDING ?? 0) + (statusCounts.IN_PROGRESS ?? 0);

      // --- SLA from tasks ---
      const now = new Date();
      let onTime = 0;
      let late = 0;
      let overduePending = 0;
      let pendingOnTrack = 0;
      let noSla = 0;
      let completionMsSum = 0;
      let completionCount = 0;
      for (const t of tasks) {
        if (t.status === 'COMPLETED') {
          if (t.completedAt) {
            completionMsSum += t.completedAt.getTime() - t.createdAt.getTime();
            completionCount += 1;
          }
          if (!t.dueDate) noSla += 1;
          else if (t.completedAt && t.completedAt <= t.dueDate) onTime += 1;
          else late += 1;
        } else if (t.status === 'PENDING') {
          if (t.dueDate && now > t.dueDate) overduePending += 1;
          else pendingOnTrack += 1;
        }
      }
      const slaConsidered = onTime + late;
      const complianceRate = slaConsidered ? Math.round((onTime / slaConsidered) * 1000) / 10 : null;
      const avgCompletionHours = completionCount
        ? Math.round((completionMsSum / completionCount / (60 * 60 * 1000)) * 10) / 10
        : null;

      // --- Throughput series (created vs completed per day) ---
      const fromDay = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
      const toDay = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
      // Cap the daily series at 366 days, always anchored at `to` (showing the
      // most recent window of a very long range rather than its oldest days).
      const seriesStart = new Date(Math.max(fromDay.getTime(), toDay.getTime() - 365 * DAY_MS));
      const dayCount = Math.floor((toDay.getTime() - seriesStart.getTime()) / DAY_MS) + 1;
      const createdByDay: Record<string, number> = {};
      const completedByDay: Record<string, number> = {};
      for (const r of requests) createdByDay[dateKey(r.createdAt)] = (createdByDay[dateKey(r.createdAt)] ?? 0) + 1;
      for (const l of completedLogs) completedByDay[dateKey(l.createdAt)] = (completedByDay[dateKey(l.createdAt)] ?? 0) + 1;
      const throughput: { date: string; created: number; completed: number }[] = [];
      for (let i = 0; i < dayCount; i++) {
        const key = dateKey(new Date(seriesStart.getTime() + i * DAY_MS));
        throughput.push({ date: key, created: createdByDay[key] ?? 0, completed: completedByDay[key] ?? 0 });
      }

      res.json({
        range: { from: from.toISOString(), to: to.toISOString() },
        totals: {
          requests: totalRequests,
          open: openRequests,
          completed: statusCounts.COMPLETED ?? 0,
          rejected: statusCounts.REJECTED ?? 0,
        },
        statusCounts,
        byFlowType: [...flowMap.values()].sort((a, b) => b.count - a.count),
        sla: {
          onTime,
          late,
          overduePending,
          pendingOnTrack,
          noSla,
          complianceRate, // % de tarefas concluídas dentro do prazo (null se sem dados)
          avgCompletionHours,
        },
        throughput,
      });
    } catch {
      res.status(500).json({ error: 'Erro ao gerar relatório' });
    }
  }
);

export default router;
