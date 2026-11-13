# Configuração e deploy do Firebase

Este quadro usa Firebase Authentication (e-mail e senha), Cloud Firestore e Firebase Hosting. O SDK é carregado pelo navegador; o projeto não precisa de dependências npm para funcionar.

## 1. Criar e configurar o projeto

1. Abra o [Console do Firebase](https://console.firebase.google.com/) e crie um projeto.
2. Em **Configurações do projeto > Seus apps**, registre um app da Web (`</>`).
3. Copie os valores do objeto `firebaseConfig` do console para `firebase-config.js`, substituindo todos os valores `COLE_...`.
4. No Console, abra **Authentication > Método de login** e habilite **E-mail/senha**.
5. Abra **Firestore Database**, crie o banco de dados e escolha a região desejada.
6. Na aba **Regras** do Firestore, publique o conteúdo do arquivo `firestore.rules`.

## 2. Dados compartilhados e permissões

- Os perfis ficam em `users/{uid}` e são atualizados no cadastro/login com `uid`, `email` e `nome`. Contas autenticadas podem consultar esses perfis para localizar a pessoa convidada pelo e-mail.
- Os quadros ficam em `boards/{boardId}` com `nome`, `dono_id` e `memberIds`. Os papéis ficam em `boards/{boardId}/members/{uid}` como `OWNER`, `EDITOR` ou `VIEWER`.
- As tarefas e colunas ficam em `boards/{boardId}/tasks/{taskId}` e `boards/{boardId}/columns/{columnId}`. As tarefas incluem `board_id` e os campos de prioridade, prazo, responsável, etiquetas, estimativa e checklist.
- Somente o `OWNER` pode convidar, trocar papéis e remover membros. `OWNER` e `EDITOR` podem alterar tarefas; `VIEWER` pode apenas ler. As regras do Firestore aplicam essas permissões também no servidor.
- A página da tarefa usa `/tasks/:id?board=:boardId`. O parâmetro identifica o quadro, porque as tarefas são armazenadas dentro de cada quadro. Comentários e histórico ficam nas subcoleções `comments` e `activities` da tarefa.
- Dados antigos em `users/{uid}/tasks` e no `localStorage` são migrados para um quadro próprio quando o usuário entra. A migração não apaga os documentos antigos do Firestore.

## 3. Publicar no Firebase Hosting

Os arquivos `firebase.json` e `.firebaserc` já apontam o Hosting e as regras do Firestore para o projeto configurado. Para publicar:

1. Instale o Node.js e o Firebase CLI, se ainda não estiverem instalados: `npm install -g firebase-tools`.
2. No terminal, na pasta do projeto, autentique-se: `firebase login`.
3. Publique o site e as regras: `firebase deploy --only hosting,firestore:rules`.
4. No Firebase Authentication, abra **Configurações > Domínios autorizados** e confirme que o domínio de Hosting está na lista.
5. Acesse `https://projeto-kanban-814d3.web.app`, crie duas contas e teste: criar um quadro, convidar a outra conta, alterar papéis e confirmar que um `VIEWER` não consegue alterar tarefas.

O deploy usa a configuração Web já existente em `firebase-config.js`. Ao usar outro projeto Firebase, atualize também o identificador em `.firebaserc`. A tela permite criar conta, entrar, sair e solicitar redefinição de senha. O Firebase exige senhas com pelo menos seis caracteres.

### Roteiro para validar e demonstrar a entrega

1. Use dois perfis do navegador (ou uma janela anônima) e crie uma conta em cada um. Como proprietário, convide a segunda conta como **Editor**. Abra o mesmo quadro nas duas janelas.
2. Crie uma tarefa e abra o título em nova aba. Copie o endereço e abra na segunda conta. Edite responsável, prazo e prioridade, adicione uma subtarefa e publique um comentário com uma @menção. Confira o responsável e as mudanças no quadro sem recarregar.
3. Em **Editar coluna**, defina um limite de WIP de 1 e coloque duas tarefas nessa coluna. Confira o aviso e o histórico de movimentação.
4. Troque a segunda conta para **Leitor**. Confirme que ela pode abrir a tarefa e ler os comentários, mas não pode editar ou comentar. Remova o acesso e confirme que o link da tarefa deixa de funcionar para essa conta.
5. Para a atividade, use a URL do Firebase Hosting, o endereço do repositório GitHub e uma demonstração de dois minutos com as duas contas.

## 4. Executar pelo VS Code

Como o aplicativo usa módulos JavaScript, não abra `index.html` diretamente com `file://`.

1. Instale a extensão **Live Server** no VS Code, se ainda não estiver instalada.
2. Abra `index.html` e selecione **Open with Live Server**.
3. No localhost ou em 127.0.0.1, os links de tarefa usam parâmetros no endereço inicial para funcionar no Live Server. No Firebase Hosting, o redirecionamento interno em `firebase.json` permite abrir e recarregar a rota `/tasks/:id`.
4. Confira o aviso abaixo do quadro: ele informa quando a conexão foi concluída e sugere o ajuste de acordo com o erro detectado.

## Diagnóstico da conexão

- **Configuração ausente**: preencha os campos obrigatórios indicados no aviso em `firebase-config.js`.
- **Arquivo local**: se o aviso pedir o Live Server, não abra a página com `file://`.
- **Provedor desativado (`auth/operation-not-allowed`)**: habilite **Authentication > Método de login > E-mail/senha**.
- **Domínio não autorizado**: adicione o domínio usado pelo Live Server em **Authentication > Configurações > Domínios autorizados**.
- **Acesso negado (`permission-denied`)**: publique `firestore.rules` e confirme que o usuário está em `boards/{boardId}/members/{uid}` com o papel adequado.
- **Rede ou serviço indisponível**: confirme a conexão e tente recarregar a página.
- **Firebase conectado**: o aviso verde confirma que a leitura do Firestore funcionou e que as tarefas estão sendo sincronizadas.

## Dados e segurança

- Cada quadro tem uma lista de membros e papéis; o acesso às tarefas é verificado pelas regras do Firestore, não apenas pela interface.
- O diretório `users` contém e-mail e nome visíveis a usuários autenticados para permitir convites por e-mail.
- O login antigo era anônimo; ao criar uma conta na mesma sessão, o app associa o e-mail à identidade anônima. Ao entrar em uma conta existente, tenta transferir as tarefas da sessão anônima atual.
- Tarefas antigas do `localStorage` e da coleção legada `users/{uid}/tasks` são copiadas para o primeiro quadro próprio. Os documentos antigos não são excluídos.
- A configuração Web (`apiKey`, `projectId` e semelhantes) é identificadora do projeto, não uma chave privada. A segurança dos dados depende das regras do Firestore; não publique regras abertas.

Referências oficiais: [adicionar o Firebase ao app Web](https://firebase.google.com/docs/web/setup), [autenticação por e-mail e senha](https://firebase.google.com/docs/auth/web/password-auth), [Firebase Hosting](https://firebase.google.com/docs/hosting) e [regras do Firestore](https://firebase.google.com/docs/firestore/security/get-started).
