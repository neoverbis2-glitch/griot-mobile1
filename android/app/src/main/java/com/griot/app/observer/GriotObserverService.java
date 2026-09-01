package com.griot.app.observer;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.AccessibilityServiceInfo;
import android.content.Intent;
import android.util.Log;
import android.os.Handler;
import android.os.Looper;
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
 * Lê a árvore de elementos nativos (AccessibilityNodeInfo) da app aberta
 * em primeiro plano e extrai os blocos de texto, código e comandos em tempo real
 * sem necessidade de chaves de API pagas (Zero-API architecture).
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

    private String lastExtractedSignature = "";
    private long lastDispatchTime = 0;

    // Vinculação de Thread Fixa e Observação em Streaming
    private String activeFixedThreadTitle = "";
    private String activePackageTarget = "";
    private String lastStreamedText = "";
    private String lastScreenSignature = "";
    private long lastScreenDispatchTime = 0L;
    private final Handler automationHandler = new Handler(Looper.getMainLooper());

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
        info.notificationTimeout = 100;
        setServiceInfo(info);
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        if (event == null) return;
        CharSequence pkgChar = event.getPackageName();
        if (pkgChar == null) return;
        String packageName = pkgChar.toString();

        // Filtrar apenas se pertencer aos pacotes monitorizados
        if (!MONITORED_PACKAGES.contains(packageName)) return;

        AccessibilityNodeInfo rootNode = null;
        AccessibilityNodeInfo sourceNode = event.getSource();
        try {
            if (sourceNode != null && sourceNode.getWindow() != null) {
                rootNode = sourceNode.getWindow().getRoot();
            }
        } finally {
            if (sourceNode != null) sourceNode.recycle();
        }

        // The active window may already be the GRIOT UI while the target AI
        // app is streaming in another accessibility window. Prefer the event
        // source's window root so observation keeps working after the quiet
        // handoff back to GRIOT.
        if (rootNode == null) rootNode = getRootInActiveWindow();
        if (rootNode == null) return;

        try {
            StringBuilder builder = new StringBuilder();
            traverseAndExtract(rootNode, builder, 0);
            String fullScreenText = builder.toString().trim();

            if (!fullScreenText.isEmpty()) {
                String signature = packageName + "_" + fullScreenText.hashCode();
                long now = System.currentTimeMillis();
                boolean hasRuntimeBlock = hasGriotActionSignature(fullScreenText);
                boolean observingActiveTurn = packageName.equals(activePackageTarget);

                // During an active external turn, forward stable UI snapshots so the
                // GRIOT WebView can reconstruct the response. Outside an active turn
                // only runtime-bearing screens are forwarded.
                if ((!signature.equals(lastScreenSignature) || now - lastScreenDispatchTime > 900)
                    && (hasRuntimeBlock || observingActiveTurn)) {
                    lastScreenSignature = signature;
                    lastScreenDispatchTime = now;
                    dispatchToGriotCore(packageName, fullScreenText);
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Erro ao analisar AccessibilityNodeInfo", e);
        } finally {
            rootNode.recycle();
        }
    }

    /**
     * Varre recursivamente a árvore nativa de nós do ecrã
     */
    private void traverseAndExtract(AccessibilityNodeInfo node, StringBuilder builder, int depth) {
        if (node == null || depth > 40) return;

        CharSequence text = node.getText();
        if (text != null && text.length() > 0 && node.isVisibleToUser()) {
            builder.append(text.toString().trim()).append("\n");
        }

        CharSequence desc = node.getContentDescription();
        if (desc != null && desc.length() > 0 && (text == null || !desc.equals(text))) {
            builder.append(desc.toString().trim()).append("\n");
        }

        int childCount = node.getChildCount();
        for (int i = 0; i < childCount; i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child != null) {
                traverseAndExtract(child, builder, depth + 1);
                child.recycle(); // Liberta memória no SO e previne vazamento de nós
            }
        }
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

        // 1. Enviar para a UI do Capacitor via Plugin em tempo real
        GriotPlugin.dispatchObserverEvent(packageName, appName, extractedText);

        // 2. Transmitir via Broadcast local
        Intent intent = new Intent(ACTION_GRIOT_EVENT);
        intent.putExtra("extra_package", packageName);
        intent.putExtra("extra_app_name", appName);
        intent.putExtra("extra_content", extractedText);
        intent.putExtra("extra_timestamp", System.currentTimeMillis());
        sendBroadcast(intent);

        // 3. A UI JavaScript decide a aprovação e gera a notificação.
        // O serviço nativo não cria IDs paralelos para evitar aprovações órfãs.
    }

    private String resolveAppName(String pkg) {
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
     * Injeta texto no chat da app alvo (ex: ChatGPT) de forma invisível/automatizada
     * e vincula ao título fixo da conversa.
     */
    public boolean injectPromptToApp(String packageName, String fixedThreadTitle, String message) {
        this.activePackageTarget = packageName;
        this.activeFixedThreadTitle = fixedThreadTitle;
        this.lastStreamedText = "";

        if (!packageName.equals(getPackageName())) {
            try {
                Intent launchIntent = getPackageManager().getLaunchIntentForPackage(packageName);
                if (launchIntent == null) {
                    Log.w(TAG, "App alvo não instalada: " + packageName);
                    return false;
                }
                launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_NO_ANIMATION);
                startActivity(launchIntent);
                automationHandler.postDelayed(() -> injectIntoActiveWindow(message), 900);
                return true;
            } catch (Exception e) {
                Log.e(TAG, "Falha ao iniciar app alvo " + packageName, e);
                return false;
            }
        }

        return injectIntoActiveWindow(message);
    }

    private boolean injectIntoActiveWindow(String message) {
        AccessibilityNodeInfo rootNode = getRootInActiveWindow();
        if (rootNode == null) {
            Log.w(TAG, "RootNode inacessível para injeção em " + activePackageTarget);
            dispatchAutomationResult(false, "Não foi possível obter a árvore da app alvo.");
            return false;
        }

        try {
            AccessibilityNodeInfo inputNode = findInputNode(rootNode);
            if (inputNode == null) {
                dispatchAutomationResult(false, "Campo de mensagem não encontrado.");
                return false;
            }

            android.os.Bundle arguments = new android.os.Bundle();
            arguments.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, message);
            boolean textSet = inputNode.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, arguments);
            inputNode.recycle();

            if (!textSet) {
                dispatchAutomationResult(false, "A app recusou a injeção do texto.");
                return false;
            }

            automationHandler.postDelayed(() -> clickSendAndReturn(), 180);
            return true;
        } catch (Exception e) {
            Log.e(TAG, "Erro na automação do prompt", e);
            dispatchAutomationResult(false, e.getMessage() == null ? "Erro de automação." : e.getMessage());
            return false;
        } finally {
            rootNode.recycle();
        }
    }

    private void clickSendAndReturn() {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) {
            dispatchAutomationResult(false, "Árvore da app alvo desapareceu antes do envio.");
            return;
        }
        try {
            AccessibilityNodeInfo sendButton = findSendButton(root);
            if (sendButton == null || !sendButton.performAction(AccessibilityNodeInfo.ACTION_CLICK)) {
                dispatchAutomationResult(false, "Botão Enviar não encontrado.");
                return;
            }
            dispatchAutomationResult(true, "Prompt enviado para " + activeFixedThreadTitle);
            // Best-effort return to GRIOT. Android does not expose a supported API
            // for true invisible interaction with a third-party foreground activity.
            automationHandler.postDelayed(this::returnToGriot, 250);
        } finally {
            root.recycle();
        }
    }

    private void returnToGriot() {
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
        if (node.isEditable() || (node.getClassName() != null && node.getClassName().toString().contains("EditText"))) {
            return node;
        }
        int childCount = node.getChildCount();
        for (int i = 0; i < childCount; i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child != null) {
                AccessibilityNodeInfo res = findInputNode(child);
                if (res != null) return res;
                child.recycle();
            }
        }
        return null;
    }

    private AccessibilityNodeInfo findSendButton(AccessibilityNodeInfo node) {
        if (node == null) return null;
        if (node.isClickable()) {
            CharSequence desc = node.getContentDescription();
            CharSequence text = node.getText();
            String descStr = desc != null ? desc.toString().toLowerCase() : "";
            String textStr = text != null ? text.toString().toLowerCase() : "";
            String viewId = node.getViewIdResourceName() != null ? node.getViewIdResourceName().toLowerCase() : "";

            if (descStr.contains("send") || descStr.contains("enviar") ||
                textStr.contains("send") || textStr.contains("enviar") ||
                viewId.contains("send") || viewId.contains("submit")) {
                return node;
            }
        }
        int childCount = node.getChildCount();
        for (int i = 0; i < childCount; i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child != null) {
                AccessibilityNodeInfo res = findSendButton(child);
                if (res != null) return res;
                child.recycle();
            }
        }
        return null;
    }

    @Override
    public void onInterrupt() {
        Log.w(TAG, "GriotObserverService interrompido pelo sistema.");
    }
}
