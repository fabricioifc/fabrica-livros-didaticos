// Leitura e validação das variáveis de ambiente (AGENTS.md, seção 12.3).
import { z } from 'zod';

const listaDeEmails = z
  .string()
  .default('')
  .transform((s) => s.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean))
  .pipe(z.array(z.email()));

const esquema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL é obrigatória'),
  DATABASE_MIGRATION_URL: z.string().min(1).optional(),
  BOOTSTRAP_ADMIN_EMAILS: listaDeEmails,
});

export function carregarConfig(env = process.env) {
  const r = esquema.safeParse(env);
  if (!r.success) {
    const problemas = r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Configuração inválida — ${problemas}`);
  }
  const c = r.data;
  return {
    ambiente: c.NODE_ENV,
    bancoUrl: c.DATABASE_URL,
    bancoMigracaoUrl: c.DATABASE_MIGRATION_URL ?? c.DATABASE_URL,
    emailsAdminInicial: c.BOOTSTRAP_ADMIN_EMAILS,
  };
}
