// Única forma de acessar o banco a partir dos serviços (AGENTS.md, seção 9.4).
// Abre uma transação, assume o papel livros_app (sujeito a RLS) e define o escopo do usuário.
import pg from 'pg';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Escopo de banco derivado das atribuições, nunca de dados enviados pelo cliente.
// { usuarioId, campi: uuid[], escopoInstitucional: bool, adminInstitucional: bool }
export function normalizarEscopo(escopo) {
  const campi = [...new Set(escopo.campi ?? [])];
  for (const id of [escopo.usuarioId, ...campi].filter((x) => x != null)) {
    if (!UUID.test(id)) throw new Error('Identificador inválido no escopo do banco.');
  }
  return {
    usuarioId: escopo.usuarioId ?? '',
    campi: `{${campi.join(',')}}`,
    escopoInstitucional: escopo.escopoInstitucional ? 'true' : 'false',
    adminInstitucional: escopo.adminInstitucional ? 'true' : 'false',
  };
}

// Processos do sistema (login, bootstrap): escopo institucional explícito e auditado pelo chamador.
export const escopoSistema = () => ({ usuarioId: null, campi: [], escopoInstitucional: true, adminInstitucional: true });

let seqSavepoint = 0;

// `executor` é um pg.Pool (transação própria) ou um client já em transação (usa SAVEPOINT;
// usado nos testes para desfazer tudo ao final).
export async function comContexto(executor, escopo, fn) {
  const valores = normalizarEscopo(escopo);
  const aninhado = !(executor instanceof pg.Pool);
  const db = aninhado ? executor : await executor.connect();
  const savepoint = `ctx_${++seqSavepoint}`;
  try {
    await db.query(aninhado ? `SAVEPOINT ${savepoint}` : 'BEGIN');
    await db.query('SET LOCAL ROLE livros_app');
    await db.query(
      `SELECT set_config('app.usuario_id', $1, true), set_config('app.campi', $2, true),
              set_config('app.escopo_institucional', $3, true), set_config('app.admin_institucional', $4, true)`,
      [valores.usuarioId, valores.campi, valores.escopoInstitucional, valores.adminInstitucional],
    );
    const resultado = await fn(db);
    if (aninhado) {
      await db.query(`RELEASE SAVEPOINT ${savepoint}`);
      await db.query('RESET ROLE');
    } else {
      await db.query('COMMIT');
    }
    return resultado;
  } catch (err) {
    await db.query(aninhado ? `ROLLBACK TO SAVEPOINT ${savepoint}` : 'ROLLBACK').catch(() => {});
    throw err;
  } finally {
    if (!aninhado) db.release();
  }
}
