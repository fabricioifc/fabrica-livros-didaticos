// Erros de aplicação com o código HTTP correspondente (docs/architecture.md, seção 8.3).
export class ErroAplicacao extends Error {
  constructor(mensagem, { status, codigo, detalhes } = {}) {
    super(mensagem);
    this.name = this.constructor.name;
    this.status = status;
    this.codigo = codigo;
    this.detalhes = detalhes;
  }
}

export class ErroValidacao extends ErroAplicacao {
  constructor(mensagem, detalhes) {
    super(mensagem, { status: 422, codigo: 'VALIDACAO', detalhes });
  }
}

export class ErroNaoAutenticado extends ErroAplicacao {
  constructor(mensagem = 'Acesso não autorizado.', codigo = 'NAO_AUTENTICADO') {
    super(mensagem, { status: 401, codigo });
  }
}

export class ErroProibido extends ErroAplicacao {
  constructor(mensagem = 'Você não tem permissão para esta ação.') {
    super(mensagem, { status: 403, codigo: 'PROIBIDO' });
  }
}

// Recurso inexistente OU fora do escopo do usuário: não revela qual dos dois.
export class ErroNaoEncontrado extends ErroAplicacao {
  constructor(mensagem = 'Registro não encontrado.') {
    super(mensagem, { status: 404, codigo: 'NAO_ENCONTRADO' });
  }
}

export class ErroConflito extends ErroAplicacao {
  constructor(mensagem, codigo = 'CONFLITO') {
    super(mensagem, { status: 409, codigo });
  }
}
