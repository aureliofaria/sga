-- Tipos de ativo configuráveis: grupo de exclusão mútua + dependência entre itens.
-- Aditivo (colunas anuláveis) — não recria a tabela, preserva os dados existentes.
ALTER TABLE "ResourceItem" ADD COLUMN "selectionGroup" TEXT;
ALTER TABLE "ResourceItem" ADD COLUMN "dependsOnId" TEXT;
