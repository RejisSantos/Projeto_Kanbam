// Endereço público do Worker. Preencha depois de publicar no Cloudflare.
const workerOrigin = "";

export async function askKanbanAi(user, payload, signal) {
  const localhost = ["localhost", "127.0.0.1"].includes(location.hostname);
  const origin = workerOrigin || (localhost ? "http://127.0.0.1:8787" : "");
  if (!origin) throw new Error("O chat ainda precisa do endereço do Worker publicado.");
  const token = await user.getIdToken();
  const response = await fetch(new URL("/api/ai/chat", origin), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify(payload),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(45000)]) : AbortSignal.timeout(45000)
  });
  const type = response.headers.get("content-type") || "";
  if (!type.includes("application/json")) {
    throw new Error("O servidor de IA não está disponível neste endereço. Confira o endereço do Worker.");
  }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Não foi possível consultar a IA.");
  return data;
}

export function setupBoardChat(getBoard, getUser) {
  const dialog = document.getElementById("ai-chat");
  const form = document.getElementById("ai-form");
  const question = document.getElementById("ai-question");
  const log = document.getElementById("ai-log");
  const feedback = document.getElementById("ai-feedback");
  const submit = form.querySelector('button[type="submit"]');
  let boardId;
  let pending;

  function reset() {
    pending?.abort();
    pending = null;
    boardId = null;
    log.replaceChildren();
    feedback.textContent = "";
    submit.disabled = false;
    form.reset();
    if (dialog.open) dialog.close();
  }

  function addMessage(label, content) {
    const message = document.createElement("p");
    const author = document.createElement("strong");
    author.textContent = label;
    message.append(author, document.createTextNode(content));
    log.append(message);
    log.scrollTop = log.scrollHeight;
  }

  document.getElementById("open-ai-chat").onclick = () => {
    const board = getBoard();
    if (!board || !getUser()) return;
    if (boardId !== board.id) reset();
    boardId = board.id;
    dialog.showModal();
  };
  document.getElementById("close-ai-chat").onclick = () => dialog.close();
  dialog.querySelectorAll("[data-question]").forEach(button => {
    button.onclick = () => {
      question.value = button.dataset.question;
      question.focus();
    };
  });

  form.onsubmit = async event => {
    event.preventDefault();
    const value = question.value.trim();
    const user = getUser();
    if (!value || pending || !user || getBoard()?.id !== boardId) return;
    const request = new AbortController();
    pending = request;
    submit.disabled = true;
    feedback.textContent = "Consultando os cartões do quadro…";
    try {
      const { answer } = await askKanbanAi(user, { boardId, question: value }, request.signal);
      if (pending !== request) return;
      addMessage("Você", value);
      addMessage("Orbit", answer);
      if (question.value.trim() === value) form.reset();
      feedback.textContent = "";
    } catch (error) {
      if (pending === request) feedback.textContent = error.name === "TimeoutError"
        ? "A resposta demorou. Tente novamente."
        : error.message;
    } finally {
      if (pending === request) {
        pending = null;
        submit.disabled = false;
      }
    }
  };

  return reset;
}
