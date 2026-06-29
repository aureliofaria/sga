-- Ramos de devolução da trilha: order para o qual a SOLICITAÇÃO DE CORREÇÃO numa
-- etapa devolve o pedido. Null = devolve para a própria etapa (padrão Fase 0).
-- Aditivo (ALTER TABLE ADD COLUMN), seguro em qualquer ordem.
ALTER TABLE "FlowStep" ADD COLUMN "returnStepOrder" INTEGER;
