-- Executado pelo PostgreSQL só na criação do volume do banco de desenvolvimento.
-- Espelha a produção: o login da aplicação é membro de livros_app e não é dono das tabelas.
-- Senha apenas para desenvolvimento local.
CREATE ROLE livros_app NOLOGIN NOBYPASSRLS;
CREATE ROLE livros_app_dev LOGIN PASSWORD 'livros_app_dev' NOBYPASSRLS IN ROLE livros_app;
