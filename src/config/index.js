// Leitura e validação das variáveis de ambiente (AGENTS.md, seção 12.3).
import { z } from 'zod';

const listaDeEmails = z
  .string()
  .default('')
  .transform((s) => s.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean))
  .pipe(z.array(z.email()));

const opcional = z.string().trim().optional().transform((s) => s || undefined);

const esquema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL é obrigatória'),
  DATABASE_MIGRATION_URL: z.string().min(1).optional(),
  BOOTSTRAP_ADMIN_EMAILS: listaDeEmails,
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().min(1).default('127.0.0.1'),
  APP_URL: z.url().default('http://localhost:3000'),
  SESSION_SECRET: opcional,
  SESSAO_INATIVIDADE_MINUTOS: z.coerce.number().int().min(5).max(24 * 60).default(60),
  // Por IP, a cada 15 minutos. Alto o bastante para uma turma inteira atrás do mesmo IP (NAT do campus).
  LIMITE_LOGIN_15MIN: z.coerce.number().int().min(10).max(100000).default(300),
  GOOGLE_CLIENT_ID: opcional,
  GOOGLE_CLIENT_SECRET: opcional,
});

export function carregarConfig(env = process.env) {
  const r = esquema.safeParse(env);
  if (!r.success) {
    const problemas = r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Configuração inválida — ${problemas}`);
  }
  const c = r.data;
  if (c.NODE_ENV === 'production' && (!c.SESSION_SECRET || c.SESSION_SECRET.length < 32)) {
    throw new Error('Configuração inválida — SESSION_SECRET: obrigatória em produção, com 32+ caracteres');
  }
  if (Boolean(c.GOOGLE_CLIENT_ID) !== Boolean(c.GOOGLE_CLIENT_SECRET)) {
    throw new Error('Configuração inválida — GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET devem ser informados juntos');
  }
  const appUrl = c.APP_URL.replace(/\/+$/, '');
  return {
    ambiente: c.NODE_ENV,
    bancoUrl: c.DATABASE_URL,
    bancoMigracaoUrl: c.DATABASE_MIGRATION_URL ?? c.DATABASE_URL,
    emailsAdminInicial: c.BOOTSTRAP_ADMIN_EMAILS,
    porta: c.PORT,
    host: c.HOST,
    appUrl,
    segredoSessao: c.SESSION_SECRET,
    inatividadeMinutos: c.SESSAO_INATIVIDADE_MINUTOS,
    limiteLogin15Min: c.LIMITE_LOGIN_15MIN,
    google: c.GOOGLE_CLIENT_ID
      ? { clientId: c.GOOGLE_CLIENT_ID, clientSecret: c.GOOGLE_CLIENT_SECRET, redirectUri: `${appUrl}/auth/callback` }
      : null,
  };
}
