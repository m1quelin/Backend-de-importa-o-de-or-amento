const express = require('express');
const multer = require('multer');
const csv = require('csv-parser');
const { Readable } = require('stream');
const { createClient } = require('@supabase/supabase-js');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ============================================
// VALIDAÇÕES
// ============================================

function validarLancamento(row) {
  if (!row.data || !row.historico || !row.debito) {
    return {
      valido: false,
      erro: 'Faltam campos obrigatórios (data, histórico, débito)'
    };
  }

  const data = new Date(row.data);
  if (isNaN(data.getTime())) {
    return {
      valido: false,
      erro: `Data inválida: ${row.data}`
    };
  }

  const debito = parseFloat(row.debito);
  if (isNaN(debito) || debito <= 0) {
    return {
      valido: false,
      erro: `Valor inválido: ${row.debito}`
    };
  }

  return { valido: true };
}

// ============================================
// ENDPOINT: IMPORTAR CSV
// ============================================

router.post('/budget', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    }

    if (!req.file.originalname.endsWith('.csv')) {
      return res.status(400).json({ error: 'Arquivo deve ser CSV' });
    }

    const rows = [];
    const erros = [];

    const stream = Readable.from([req.file.buffer.toString('utf-8')]);

    stream
      .pipe(csv())
      .on('data', (row, index) => {
        const validacao = validarLancamento(row);

        if (!validacao.valido) {
          erros.push({
            linha: index + 2,
            erro: validacao.erro
          });
          return;
        }

        const data = new Date(row.data);
        rows.push({
          data: data.toISOString().split('T')[0],
          historico: row.historico.trim(),
          filial: row.filial ? row.filial.trim() : null,
          debito: parseFloat(row.debito),
          credito: row.credito ? parseFloat(row.credito) : 0,
          categoria: row.categoria ? row.categoria.trim() : null,
          mes: data.getMonth() + 1,
          ano: data.getFullYear()
        });
      })
      .on('end', async () => {
        if (erros.length > 0) {
          return res.status(400).json({
            error: 'CSV contém erros',
            erros: erros,
            totalErros: erros.length
          });
        }

        if (rows.length === 0) {
          return res.status(400).json({ error: 'Nenhuma linha válida no CSV' });
        }

        const { data, error } = await supabase
          .from('lancamentos')
          .insert(rows);

        if (error) {
          console.error('Erro ao inserir:', error);
          return res.status(500).json({
            error: 'Erro ao salvar no banco de dados',
            details: error.message
          });
        }

        res.json({
          sucesso: true,
          linhasImportadas: rows.length,
          mensagem: `${rows.length} lançamentos importados com sucesso`
        });
      })
      .on('error', (error) => {
        console.error('Erro ao parsear CSV:', error);
        res.status(400).json({
          error: 'Erro ao ler o arquivo CSV',
          details: error.message
        });
      });
  } catch (error) {
    console.error('Erro geral:', error);
    res.status(500).json({
      error: 'Erro interno do servidor',
      details: error.message
    });
  }
});

module.exports = router;
