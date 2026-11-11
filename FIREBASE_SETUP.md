# Configuração do Firebase

Este quadro usa Firebase Authentication (login anônimo) e Cloud Firestore. O SDK é carregado pelo navegador; não é necessário instalar dependências npm.

## 1. Criar e configurar o projeto

1. Abra o [Console do Firebase](https://console.firebase.google.com/) e crie um projeto.
2. Em **Configurações do projeto > Seus apps**, registre um app da Web (`</>`).
3. Copie os valores do objeto `firebaseConfig` do console para `firebase-config.js`, substituindo todos os valores `COLE_...`.
4. No Console, abra **Authentication > Método de login** e habilite **Anônimo**.
5. Abra **Firestore Database**, crie o banco de dados e escolha a região desejada.
6. Na aba **Regras** do Firestore, publique o conteúdo do arquivo `firestore.rules`.

## 2. Executar pelo VS Code

Como o aplicativo usa módulos JavaScript, não abra `index.html` diretamente com `file://`.

1. Instale a extensão **Live Server** no VS Code, se ainda não estiver instalada.
2. Abra `index.html` e selecione **Open with Live Server**.
3. Confira o aviso abaixo do quadro: ele informa quando a conexão foi concluída e sugere o ajuste de acordo com o erro detectado.

## Diagnóstico da conexão

- **Modo local**: os campos obrigatórios indicados no aviso precisam ser preenchidos em `firebase-config.js`.
- **Arquivo local**: se o aviso pedir o Live Server, não abra a página com `file://`.
- **Login anônimo**: habilite **Authentication > Método de login > Anônimo**.
- **Domínio não autorizado**: adicione o domínio usado pelo Live Server em **Authentication > Configurações > Domínios autorizados**.
- **Acesso negado (`permission-denied`)**: publique `firestore.rules` e confirme que elas permitem `users/{uid}/tasks/{taskId}` para o usuário autenticado.
- **Rede ou serviço indisponível**: confirme a conexão e tente recarregar a página.
- **Firebase conectado**: o aviso verde confirma que a leitura do Firestore funcionou e que as tarefas estão sendo sincronizadas.

## Dados e segurança

- As tarefas ficam em `users/{uid}/tasks/{taskId}`; as regras permitem acesso apenas ao usuário autenticado correspondente.
- O login anônimo identifica este navegador. Para compartilhar o mesmo quadro entre dispositivos, será necessário adicionar um método de login permanente.
- Tarefas salvas no `localStorage` que ainda não existirem na coleção do usuário são enviadas para a nuvem durante a conexão.
- A configuração Web (`apiKey`, `projectId` e semelhantes) é identificadora do projeto, não uma chave privada. A segurança dos dados depende das regras do Firestore; não publique regras abertas.

Referências oficiais: [adicionar o Firebase ao app Web](https://firebase.google.com/docs/web/setup), [login anônimo](https://firebase.google.com/docs/auth/web/anonymous-auth) e [regras do Firestore](https://firebase.google.com/docs/firestore/security/get-started).
