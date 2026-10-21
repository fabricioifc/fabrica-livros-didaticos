// Login com o Google (OpenID Connect, Authorization Code + PKCE, state e nonce).
// A biblioteca valida assinatura, emissor, audiência, validade e nonce do ID token;
// a decisão sobre o domínio fica em classificarIdentidade (módulo de acesso).
import * as oidc from 'openid-client';

const EMISSOR = new URL('https://accounts.google.com');

export function criarProvedorGoogle({ clientId, clientSecret, redirectUri }) {
  let configuracao;
  const obterConfiguracao = async () => {
    configuracao ??= await oidc.discovery(EMISSOR, clientId, clientSecret);
    return configuracao;
  };

  return {
    // Gera a URL de login e os segredos de uso único que ficam na sessão até o retorno.
    async iniciarLogin() {
      const verificador = oidc.randomPKCECodeVerifier();
      const verificacao = { verificador, estado: oidc.randomState(), nonce: oidc.randomNonce() };
      const url = oidc.buildAuthorizationUrl(await obterConfiguracao(), {
        redirect_uri: redirectUri,
        scope: 'openid email profile',
        code_challenge: await oidc.calculatePKCECodeChallenge(verificador),
        code_challenge_method: 'S256',
        state: verificacao.estado,
        nonce: verificacao.nonce,
        prompt: 'select_account',
      });
      return { url: url.href, verificacao };
    },

    // Troca o código pelo ID token e devolve suas claims (sub, email, email_verified, hd, name).
    async concluirLogin(urlDeRetorno, verificacao) {
      const tokens = await oidc.authorizationCodeGrant(await obterConfiguracao(), urlDeRetorno, {
        pkceCodeVerifier: verificacao.verificador,
        expectedState: verificacao.estado,
        expectedNonce: verificacao.nonce,
        idTokenExpected: true,
      });
      return tokens.claims();
    },
  };
}
