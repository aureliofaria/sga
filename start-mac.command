#!/bin/bash
# ==== APROVA - abrir no macOS (de dois cliques neste arquivo) ====
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "[!] Node.js nao encontrado."
  echo "    Vou abrir a pagina de download. Instale a versao LTS,"
  echo "    depois de dois cliques NESTE arquivo novamente."
  echo ""
  open "https://nodejs.org/pt-br/download" 2>/dev/null
  read -r -p "Pressione Enter para sair..."
  exit 1
fi
node launch.mjs
echo ""
echo "(O APROVA foi encerrado. Voce pode fechar esta janela.)"
read -r -p "Pressione Enter para sair..."
