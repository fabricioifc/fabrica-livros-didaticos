// Validação de anos letivos e cursos (RF-012). Funções puras.
// Os livros são anuais: não há turmas nem semestres (D-21).
import { z } from 'zod';
import { ErroValidacao } from '../../infra/erros.js';

// Data no formato do campo de data do navegador (AAAA-MM-DD), conferindo se o dia existe.
const data = (rotulo) => z.string().trim().refine((s) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}, `Informe a data de ${rotulo}.`);

export const esquemaAnoLetivo = z.object({
  ano: z.coerce.number({ error: 'Informe o ano.' }).int('Ano: número inteiro (ex.: 2027).').min(2000, 'Ano: entre 2000 e 2100.').max(2100, 'Ano: entre 2000 e 2100.'),
  inicio: data('início das aulas'),
  fim: data('término das aulas'),
}).refine((p) => p.fim > p.inicio, { path: ['fim'], message: 'O término deve ser depois do início.' });

export const esquemaCurso = z.object({
  nome: z.string().trim().min(2, 'Informe o nome do curso.').max(120, 'Curso: no máximo 120 caracteres.'),
});

// Mesmo formato de erro dos demais formulários: { campo: mensagem }.
export function validarOferta(esquema, entrada) {
  const r = esquema.safeParse(entrada);
  if (r.success) return r.data;
  const porCampo = {};
  for (const issue of r.error.issues) porCampo[issue.path[0] ?? 'geral'] ??= issue.message;
  throw new ErroValidacao('Corrija os campos indicados.', porCampo);
}
