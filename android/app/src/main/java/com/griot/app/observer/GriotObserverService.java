package com.griot.app.observer;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.AccessibilityServiceInfo;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import com.griot.app.notifications.GriotNotificationHelper;
import com.griot.app.plugin.GriotPlugin;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

/**
 * GriotObserverService
 * Serviço de Acessibilidade nativo do Android para o GRIOT.
 *
 * Comunica diretamente com as 8 apps de IA externas (ChatGPT, Claude, Gemini,
 * DeepSeek, Kimi, Grok, Perplexity, Mistral), injeta prompts na thread vinculada,
 * observa a resposta gerada em tempo real e transmite os dados para o GRIOT.
 */
public class GriotObserverService extends AccessibilityService {

    private static final String TAG = "GriotObserverService";
    public static final String ACTION_GRIOT_EVENT = "com.griot.app.OBSERVER_EVENT";

    private static GriotObserverService instance;

    public static final Set<String> MONITORED_PACKAGES = new HashSet<>(Arrays.asList(
        "com.openai.chatgpt",
        "com.anthropic.claude",
        "com.google.gemini",
        "com.google.android.apps.bard",
        "com.deepseek.chat",
        "com.moonshot.kimi",
        "ai.x.grok",
        "ai.perplexity.app.android",
        "ai.mistral.chat"
    ));

    // Estado da automação e observação ativa
    private String activeFixedThreadTitle = "";
    private String activePackageTarget = "";
    private String activePromptMessage = "";
    private String lastStreamedText = "";
    private String lastScreenSignature = "";
    private long lastScreenDispatchTime = 0L;
    private boolean observingActiveTurn = false;

    private final Handler automationHandler = new Handler(Looper.getMainLooper());

    private final Runnable finishObservationRunnable = new Runnable() {
        @Override
        public void run() {
            if (observingActiveTurn && !lastStreamedText.isEmpty()) {
                Log.i(TAG, "Observação concluída para " + activePackageTarget + ". Total chars: " + lastStreamedText.length());
                GriotPlugin.dispatchStreamChunk(activeFixedThreadTitle, lastStreamedText, true);
                observingActiveTurn = false;
                automationHandler.postDelayed(() -> returnToGriot(), 300);
            }
        }
    };

    private final Runnable safetyReturnRunnable = new Runnable() {
        @Override
        public void run() {
            if (observingActiveTurn) {
                Log.w(TAG, "Temporizador de segurança disparado para " + activePackageTarget);
                if (!lastStreamedText.isEmpty()) {
                    GriotPlugin.dispatchStreamChunk(activeFixedThreadTitle, lastStreamedText, true);
                }
                observingActiveTurn = false;
                returnToGriot();
            }
        }
    };

    public static GriotObserverService getInstance() {
        return instance;
    }

    @Override
    public void onServiceConnected() {
        super.onServiceConnected();
        instance = this;
        Log.i(TAG, "GriotObserverService ligado e ativo no Android com Thread Binding.");

        AccessibilityServiceInfo info = new AccessibilityServiceInfo();
        info.eventTypes = AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED |
                          AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED |
                          AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED;
        info.feedbackType = AccessibilityServiceInfo.FEEDBACK_GENERIC;
        info.flags = AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS |
                     AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS |
                     AccessibilityServiceInfo.FLAG_INCLUDE_NOT_IMPORTANT_VIEWS;
        info.notificationTimeout = 80;
        setServiceInfo(info);
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        if (event == null) return;
        CharSequence pkgChar = event.getPackageName();
        if (pkgChar == null) return;
        String packageName = pkgChar.toString();

        if (!MONITORED_PACKAGES.contains(packageName)) return;

        AccessibilityNodeInfo rootNode = null;
        AccessibilityNodeInfo sourceNode = event.getSource();
        try {
            if (sourceNode != null && sourceNode.getWindow() != null) {
                rootNode = sourceNode.getWindow().getRoot();
            }
        } catch (Exception ignored) {
        } finally {
            if (sourceNode != null) sourceNode.recycle();
        }

        if (rootNode == null) {
            try {
                rootNode = getRootInActiveWindow();
            } catch (Exception ignored) {}
        }
        if (rootNode == null) return;

        try {
            StringBuilder builder = new StringBuilder();
            traverseAndExtract(rootNode, builder, 0);
            String fullScreenText = builder.toString().trim();

            if (!fullScreenText.isEmpty()) {
                String signature = packageName + "_" + fullScreenText.hashCode();
                long now = System.currentTimeMillis();
                boolean isCurrentTarget = packageName.equals(activePackageTarget);

                if (isCurrentTarget && observingActiveTurn) {
                    // Extrai a resposta limpa da IA externa
                    String cleanResponse = extractAssistantResponse(fullScreenText, activePromptMessage);
                    if (!cleanResponse.isEmpty() && !cleanResponse.equals(lastStreamedText)) {
                        lastStreamedText = cleanResponse;
                        lastScreenSignature = signature;
                        lastScreenDispatchTime = now;

                        // Emite o fragmento de streaming em tempo real para o GRIOT
                        GriotPlugin.dispatchStreamChunk(activeFixedThreadTitle, cleanResponse, false);
                        GriotPlugin.dispatchObserverEvent(packageName, resolveAppName(packageName), cleanResponse);

                        // Reinicia o detector de estabilidade: se ficar 2500ms sem novo texto, a IA terminou de gerar
                        automationHandler.removeCallbacks(finishObservationRunnable);
                        automationHandler.postDelayed(finishObservationRunnable, 2500);
                    }
                } else {
                    boolean hasRuntimeBlock = hasGriotActionSignature(fullScreenText);
                    if ((!signature.equals(lastScreenSignature) || now - lastScreenDispatchTime > 1200) && hasRuntimeBlock) {
                        lastScreenSignature = signature;
                        lastScreenDispatchTime = now;
                        dispatchToGriotCore(packageName, fullScreenText);
                    }
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Erro ao analisar AccessibilityNodeInfo", e);
        } finally {
            try {
                rootNode.recycle();
            } catch (Exception ignored) {}
        }
    }

    private void traverseAndExtract(AccessibilityNodeInfo node, StringBuilder builder, int depth) {
        if (node == null || depth > 45) return;

        CharSequence text = node.getText();
        if (text != null && text.length() > 0 && node.isVisibleToUser()) {
            builder.append(text.toString().trim()).append("\n");
        }

        CharSequence desc = node.getContentDescription();
        if (desc != null && desc.length() > 0 && (text == null || !desc.equals(text)) && node.isVisibleToUser()) {
            builder.append(desc.toString().trim()).append("\n");
        }

        int childCount = node.getChildCount();
        for (int i = 0; i < childCount; i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child != null) {
                traverseAndExtract(child, builder, depth + 1);
                try {
                    child.recycle();
                } catch (Exception ignored) {}
            }
        }
    }

    /**
     * Extrai apenas o texto gerado pela IA assistente, removendo o cabeçalho,
     * o prompt do utilizador e botões de interface comuns.
     */
    private String extractAssistantResponse(String fullScreenText, String prompt) {
        if (fullScreenText == null || fullScreenText.isEmpty()) return "";

        String candidate = fullScreenText;

        // Se o prompt original for encontrado, a resposta está tipicamente a seguir ao prompt
        if (prompt != null && !prompt.isEmpty()) {
            int promptIdx = candidate.indexOf(prompt);
            if (promptIdx != -1) {
                candidate = candidate.substring(promptIdx + prompt.length()).trim();
            } else {
                // Tenta encontrar primeiros 30 caracteres do prompt
                String prefix = prompt.length() > 30 ? prompt.substring(0, 30) : prompt;
                int prefixIdx = candidate.indexOf(prefix);
                if (prefixIdx != -1) {
                    candidate = candidate.substring(prefixIdx + prefix.length()).trim();
                }
            }
        }

        // Limpeza de botões e textos de UI recorrentes
        String[] lines = candidate.split("\n");
        StringBuilder sb = new StringBuilder();
        for (String line : lines) {
            String l = line.trim();
            if (l.isEmpty()) continue;
            String lower = l.toLowerCase();

            // Ignorar rótulos de botões comuns de apps de IA
            if (lower.equals("copy") || lower.equals("copiar") ||
                lower.equals("share") || lower.equals("partilhar") || lower.equals("compartilhar") ||
                lower.equals("regenerate") || lower.equals("regenerar") || lower.equals("tentar novamente") ||
                lower.equals("good response") || lower.equals("bad response") ||
                lower.equals("read aloud") || lower.equals("ler em voz alta") ||
                lower.equals("edit") || lower.equals("editar") ||
                lower.startsWith("ask anything") || lower.startsWith("message") || lower.startsWith("escreva") ||
                lower.startsWith("digite") || lower.startsWith("como posso ajudar") ||
                lower.equals("chatgpt") || lower.equals("claude") || lower.equals("gemini") ||
                lower.equals("deepseek") || lower.equals("kimi") || lower.equals("grok")) {
                continue;
            }

            sb.append(l).append("\n");
        }

        return sb.toString().trim();
    }

    private boolean hasGriotActionSignature(String text) {
        return text.contains("<griot_action") ||
               text.contains("```griot:") ||
               text.contains("```sh") ||
               text.contains("shell.exec") ||
               text.contains("<plugin ") ||
               text.contains("[GRIOT:") ||
               text.contains("npm run ") ||
               text.contains("git commit");
    }

    private void dispatchToGriotCore(String packageName, String extractedText) {
        String appName = resolveAppName(packageName);
        Log.i(TAG, "Ação detetada em [" + appName + "]: " + extractedText.length() + " caracteres.");

        GriotPlugin.dispatchObserverEvent(packageName, appName, extractedText);

        Intent intent = new Intent(ACTION_GRIOT_EVENT);
        intent.putExtra("extra_package", packageName);
        intent.putExtra("extra_app_name", appName);
        intent.putExtra("extra_content", extractedText);
        intent.putExtra("extra_timestamp", System.currentTimeMillis());
        sendBroadcast(intent);
    }

    public String resolveAppName(String pkg) {
        if (pkg.contains("chatgpt")) return "ChatGPT";
        if (pkg.contains("claude")) return "Claude";
        if (pkg.contains("gemini") || pkg.contains("bard")) return "Gemini";
        if (pkg.contains("deepseek")) return "DeepSeek";
        if (pkg.contains("kimi") || pkg.contains("moonshot")) return "Kimi";
        if (pkg.contains("grok")) return "Grok";
        if (pkg.contains("perplexity")) return "Perplexity";
        if (pkg.contains("mistral")) return "Le Chat";
        return "App de IA";
    }

    /**
     * Injeta texto no chat da app alvo (ex: ChatGPT) e observa a resposta real.
     */
    public boolean injectPromptToApp(String packageName, String fixedThreadTitle, String message) {
        this.activePackageTarget = packageName;
        this.activeFixedThreadTitle = fixedThreadTitle;
        this.activePromptMessage = message != null ? message.trim() : "";
        this.lastStreamedText = "";
        this.observingActiveTurn = true;

        automationHandler.removeCallbacks(finishObservationRunnable);
        automationHandler.removeCallbacks(safetyReturnRunnable);

        if (!packageName.equals(getPackageName())) {
            try {
                Intent launchIntent = getPackageManager().getLaunchIntentForPackage(packageName);
                if (launchIntent == null) {
                    launchIntent = new Intent(Intent.ACTION_MAIN);
                    launchIntent.addCategory(Intent.CATEGORY_LAUNCHER);
                    launchIntent.setPackage(packageName);
                }

                launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_NO_ANIMATION);
                startActivity(launchIntent);
                automationHandler.postDelayed(() -> attemptInjectionWithRetries(message, 1), 500);
                return true;
            } catch (Exception e) {
                Log.e(TAG, "Falha ao iniciar app alvo " + packageName, e);
                dispatchAutomationResult(false, "Erro ao iniciar a app " + resolveAppName(packageName) + ": " + e.getMessage());
                observingActiveTurn = false;
                return false;
            }
        }

        return injectIntoActiveWindow(message);
    }

    private void attemptInjectionWithRetries(final String message, final int attempt) {
        if (attempt > 14) {
            Log.w(TAG, "Tempo limite excedido ao procurar campo de entrada em " + activePackageTarget);
            dispatchAutomationResult(false, "Não foi possível encontrar a caixa de texto em " + resolveAppName(activePackageTarget));
            observingActiveTurn = false;
            returnToGriot();
            return;
        }

        AccessibilityNodeInfo rootNode = null;
        try {
            rootNode = getRootInActiveWindow();
        } catch (Exception ignored) {}

        if (rootNode == null) {
            automationHandler.postDelayed(() -> attemptInjectionWithRetries(message, attempt + 1), 300);
            return;
        }

        // SEGURANÇA CRÍTICA: Nunca injetar no próprio GRIOT ou no teclado do utilizador!
        CharSequence rootPkg = rootNode.getPackageName();
        if (rootPkg != null && rootPkg.toString().equals(getPackageName())) {
            try { rootNode.recycle(); } catch (Exception ignored) {}
            // A app alvo ainda está a transitar para primeiro plano. Aguardar!
            automationHandler.postDelayed(() -> attemptInjectionWithRetries(message, attempt + 1), 300);
            return;
        }

        AccessibilityNodeInfo inputNode = findInputNode(rootNode);
        if (inputNode == null) {
            try { rootNode.recycle(); } catch (Exception ignored) {}
            automationHandler.postDelayed(() -> attemptInjectionWithRetries(message, attempt + 1), 300);
            return;
        }

        try {
            // 1. Clicar no campo para ativar o estado de edição (essencial em Jetpack Compose / React Native)
            inputNode.performAction(AccessibilityNodeInfo.ACTION_CLICK);

            automationHandler.postDelayed(() -> {
                try {
                    // 2. Focar
                    inputNode.performAction(AccessibilityNodeInfo.ACTION_FOCUS);

                    // 3. Definir texto via API nativa
                    Bundle arguments = new Bundle();
                    arguments.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, message);
                    boolean textSet = inputNode.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, arguments);

                    if (!textSet) {
                        // Fallback: colagem via Clipboard
                        try {
                            ClipboardManager clipboard = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                            if (clipboard != null) {
                                clipboard.setPrimaryClip(ClipData.newPlainText("griot_prompt", message));
                                inputNode.performAction(AccessibilityNodeInfo.ACTION_PASTE);
                            }
                        } catch (Exception clipEx) {
                            Log.w(TAG, "Falha no fallback de colagem:", clipEx);
                        }
                    }

                    // 4. Disparar clique no botão Enviar
                    automationHandler.postDelayed(() -> clickSendAndObserve(rootNode, inputNode), 250);
                } catch (Exception ex) {
                    Log.e(TAG, "Erro na atribuição de texto", ex);
                    try { rootNode.recycle(); } catch (Exception ignored) {}
                    try { inputNode.recycle(); } catch (Exception ignored) {}
                }
            }, 120);

        } catch (Exception e) {
            Log.e(TAG, "Erro na automação do prompt", e);
            dispatchAutomationResult(false, e.getMessage() == null ? "Erro de automação." : e.getMessage());
            observingActiveTurn = false;
            try { rootNode.recycle(); } catch (Exception ignored) {}
            try { inputNode.recycle(); } catch (Exception ignored) {}
            returnToGriot();
        }
    }

    private boolean injectIntoActiveWindow(String message) {
        attemptInjectionWithRetries(message, 1);
        return true;
    }

    private void clickSendAndObserve(AccessibilityNodeInfo root, AccessibilityNodeInfo inputNode) {
        boolean sent = false;
        try {
            AccessibilityNodeInfo sendButton = findSendButton(root, inputNode);
            if (sendButton != null) {
                sent = sendButton.performAction(AccessibilityNodeInfo.ACTION_CLICK);
                try { sendButton.recycle(); } catch (Exception ignored) {}
            }

            if (!sent && inputNode != null) {
                sent = inputNode.performAction(AccessibilityNodeInfo.ACTION_IME_ACTION);
            }

            if (sent) {
                dispatchAutomationResult(true, "Mensagem enviada para " + resolveAppName(activePackageTarget));
                // Define temporizador de segurança de 45 segundos para resposta
                automationHandler.postDelayed(safetyReturnRunnable, 45000);
            } else {
                dispatchAutomationResult(false, "Botão Enviar não encontrado em " + resolveAppName(activePackageTarget));
                observingActiveTurn = false;
                automationHandler.postDelayed(this::returnToGriot, 600);
            }
        } finally {
            try { if (root != null) root.recycle(); } catch (Exception ignored) {}
            try { if (inputNode != null) inputNode.recycle(); } catch (Exception ignored) {}
        }
    }

    public void returnToGriot() {
        automationHandler.removeCallbacks(safetyReturnRunnable);
        automationHandler.removeCallbacks(finishObservationRunnable);
        try {
            Intent intent = getPackageManager().getLaunchIntentForPackage(getPackageName());
            if (intent != null) {
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
                startActivity(intent);
            }
        } catch (Exception e) {
            Log.w(TAG, "Não foi possível trazer o GRIOT para a frente.", e);
        }
    }

    private void dispatchAutomationResult(boolean success, String message) {
        GriotPlugin.dispatchAutomationResult(activePackageTarget, activeFixedThreadTitle, success, message);
    }

    private AccessibilityNodeInfo findInputNode(AccessibilityNodeInfo node) {
        if (node == null) return null;
        if (node.isEditable()) return node;

        CharSequence className = node.getClassName();
        if (className != null && className.toString().contains("EditText")) {
            return node;
        }

        // Detetar nós de entrada Compose ou descrições acessíveis
        CharSequence desc = node.getContentDescription();
        CharSequence hint = node.getHintText();
        String d = desc != null ? desc.toString().toLowerCase() : "";
        String h = hint != null ? hint.toString().toLowerCase() : "";
        String v = node.getViewIdResourceName() != null ? node.getViewIdResourceName().toLowerCase() : "";

        if ((node.isFocusable() || node.isClickable()) &&
            (d.contains("message") || d.contains("prompt") || d.contains("ask") || d.contains("pergunta") ||
             d.contains("escreva") || d.contains("digite") || h.contains("message") || h.contains("ask") ||
             v.contains("input") || v.contains("edit_text") || v.contains("chat_input"))) {
            return node;
        }

        int childCount = node.getChildCount();
        for (int i = 0; i < childCount; i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child != null) {
                AccessibilityNodeInfo res = findInputNode(child);
                if (res != null) return res;
                try { child.recycle(); } catch (Exception ignored) {}
            }
        }
        return null;
    }

    private AccessibilityNodeInfo findSendButton(AccessibilityNodeInfo root, AccessibilityNodeInfo inputNode) {
        // 1. Procurar primeiro nos nós irmãos adjacentes ao campo de texto na barra inferior
        if (inputNode != null) {
            AccessibilityNodeInfo parent = inputNode.getParent();
            if (parent != null) {
                int count = parent.getChildCount();
                for (int i = 0; i < count; i++) {
                    AccessibilityNodeInfo sibling = parent.getChild(i);
                    if (sibling != null && !sibling.equals(inputNode)) {
                        if (sibling.isClickable() || sibling.isEnabled()) {
                            CharSequence desc = sibling.getContentDescription();
                            CharSequence txt = sibling.getText();
                            String d = desc != null ? desc.toString().toLowerCase() : "";
                            String t = txt != null ? txt.toString().toLowerCase() : "";
                            String v = sibling.getViewIdResourceName() != null ? sibling.getViewIdResourceName().toLowerCase() : "";
                            if (d.contains("send") || d.contains("enviar") || d.contains("prompt") || d.contains("arrow") ||
                                d.contains("submit") || d.contains("发送") || d.contains("paperplane") ||
                                t.contains("send") || t.contains("enviar") ||
                                v.contains("send") || v.contains("submit") || v.contains("btn")) {
                                return sibling;
                            }
                        }
                    }
                }
            }
        }

        // 2. Busca recursiva no root
        return searchSendButtonRecursive(root);
    }

    private AccessibilityNodeInfo searchSendButtonRecursive(AccessibilityNodeInfo node) {
        if (node == null) return null;
        if (node.isClickable()) {
            CharSequence desc = node.getContentDescription();
            CharSequence text = node.getText();
            String descStr = desc != null ? desc.toString().toLowerCase() : "";
            String textStr = text != null ? text.toString().toLowerCase() : "";
            String viewId = node.getViewIdResourceName() != null ? node.getViewIdResourceName().toLowerCase() : "";

            if (descStr.contains("send") || descStr.contains("enviar") || descStr.contains("prompt") ||
                descStr.contains("arrow") || descStr.contains("submit") || descStr.contains("发送") ||
                descStr.contains("paperplane") ||
                textStr.contains("send") || textStr.contains("enviar") ||
                viewId.contains("send") || viewId.contains("submit") || viewId.contains("btn")) {
                return node;
            }
        }
        int childCount = node.getChildCount();
        for (int i = 0; i < childCount; i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child != null) {
                AccessibilityNodeInfo res = searchSendButtonRecursive(child);
                if (res != null) return res;
                try { child.recycle(); } catch (Exception ignored) {}
            }
        }
        return null;
    }

    @Override
    public void onInterrupt() {
        Log.w(TAG, "GriotObserverService interrompido pelo sistema.");
    }
}
