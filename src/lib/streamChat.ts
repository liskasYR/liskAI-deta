type Msg = { role: "user" | "assistant"; content: string };

export async function streamChat({
  messages,
  model = "LPT-3.5",
  generateImage = false,
  onDelta,
  onImage,
  onDone,
  onError,
}: {
  messages: Msg[];
  model?: string;
  generateImage?: boolean;
  onDelta: (deltaText: string) => void;
  onImage?: (imageUrl: string) => void;
  onDone: () => void;
  onError?: (error: string) => void;
}) {
  const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`;

  try {
    const resp = await fetch(CHAT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
      },
      body: JSON.stringify({ messages, model, generateImage }),
    });

    if (!resp.ok) {
      const errorData = await resp.json().catch(() => ({ error: "שגיאה לא ידועה" }));
      onError?.(errorData.error || "שגיאה בשליחת ההודעה");
      return;
    }

    if (!resp.body) {
      onError?.("לא התקבלה תשובה");
      return;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let textBuffer = "";
    let streamDone = false;

    while (!streamDone) {
      const { done, value } = await reader.read();
      if (done) break;
      textBuffer += decoder.decode(value, { stream: true });

      let newlineIndex: number;
      while ((newlineIndex = textBuffer.indexOf("\n")) !== -1) {
        let line = textBuffer.slice(0, newlineIndex);
        textBuffer = textBuffer.slice(newlineIndex + 1);

        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (line.startsWith(":") || line.trim() === "") continue;
        if (!line.startsWith("data: ")) continue;

        const jsonStr = line.slice(6).trim();
        if (jsonStr === "[DONE]") {
          streamDone = true;
          break;
        }

        try {
          const parsed = JSON.parse(jsonStr);
          const content = parsed.choices?.[0]?.delta?.content as string | undefined;
          if (content) onDelta(content);
          
          // Check for images
          const images = parsed.choices?.[0]?.message?.images;
          if (images && onImage) {
            for (const img of images) {
              if (img.image_url?.url) {
                onImage(img.image_url.url);
              }
            }
          }
        } catch {
          textBuffer = line + "\n" + textBuffer;
          break;
        }
      }
    }

    if (textBuffer.trim()) {
      for (let raw of textBuffer.split("\n")) {
        if (!raw) continue;
        if (raw.endsWith("\r")) raw = raw.slice(0, -1);
        if (raw.startsWith(":") || raw.trim() === "") continue;
        if (!raw.startsWith("data: ")) continue;
        const jsonStr = raw.slice(6).trim();
        if (jsonStr === "[DONE]") continue;
        try {
          const parsed = JSON.parse(jsonStr);
          const content = parsed.choices?.[0]?.delta?.content as string | undefined;
          if (content) onDelta(content);
          
          // Check for images
          const images = parsed.choices?.[0]?.message?.images;
          if (images && onImage) {
            for (const img of images) {
              if (img.image_url?.url) {
                onImage(img.image_url.url);
              }
            }
          }
        } catch {
          /* ignore partial leftovers */
        }
      }
    }

    onDone();
  } catch (error) {
    console.error("Stream error:", error);
    onError?.(error instanceof Error ? error.message : "שגיאה בחיבור");
  }
}
