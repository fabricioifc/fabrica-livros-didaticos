-- Somente DESENVOLVIMENTO. Versão 1 FICTÍCIA do termo de compromisso (RF-080), para as entregas
-- poderem ser testadas. Não é o texto oficial (o texto real será publicado pela administração institucional).
-- Só é criada se ainda não houver nenhuma versão (não interfere nas publicadas pela interface).

INSERT INTO termo_modelo (versao, texto, hash_texto, publicado_por)
SELECT 1,
       E'TEXTO FICTÍCIO DE EXEMPLO — não é o termo oficial.\n\n'
       || E'Eu, {estudante}, matrícula {matricula}, estudante do curso {curso} ({serie}) no {campus}, declaro que recebi em {data} os livros didáticos: {livros}.\n\n'
       || E'Comprometo-me a conservá-los e a devolvê-los no prazo informado pelo setor responsável, no mesmo campus em que os recebi.',
       '', (SELECT id FROM usuario WHERE google_sub = 'seed-dev-srv-06')
WHERE NOT EXISTS (SELECT 1 FROM termo_modelo);
