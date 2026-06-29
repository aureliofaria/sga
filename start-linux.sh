#!/bin/bash
# ==== APROVA - abrir no Linux (de dois cliques ou: ./start-linux.sh) ====
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "[!] Node.js nao encontrado. Instale a versao LTS:"
  echo "    https://nodejs.org/pt-br/download"
  echo "    (ou use o gerenciador de pacotes da sua distribuicao)"
  echo ""
  xdg-open "https://nodejs.org/pt-br/download" 2>/dev/null
  read -r -p "Pressione Enter para sair..."
  exit 1
fi
node launch.mjs
echo ""
echo "(O APROVA foi encerrado. Voce pode fechar esta janela.)"
read -r -p "Pressione Enter para sair..."
