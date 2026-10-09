"use server";

import { z } from "zod";
import { schoolAction } from "@/server/action";
import { reportMessage, sendMessage, setMessageHidden, startConversation } from "@/server/services/messaging";
import { checkbox, file, id, optionalId, optionalText, text } from "@/lib/zod";

export const startConversationAction = schoolAction(
  {
    permission: "message.send",
    schema: z.object({
      toUserId: id,
      studentId: optionalId,
      subject: optionalText(120),
      body: optionalText(4000),
      audio: file.optional(),
    }),
  },
  async (ctx, input) => {
    const conversation = await startConversation(ctx, input);
    return { id: conversation.id };
  },
);

export const sendMessageAction = schoolAction(
  {
    permission: "message.send",
    schema: z.object({ conversationId: id, body: optionalText(4000), audio: file.optional() }),
  },
  async (ctx, input) => {
    await sendMessage(ctx, input);
  },
);

export const reportMessageAction = schoolAction(
  { permission: "message.send", schema: z.object({ messageId: id, reason: text(300) }) },
  async (ctx, input) => reportMessage(ctx, input),
);

export const moderateMessageAction = schoolAction(
  { permission: "message.moderate", schema: z.object({ messageId: id, hidden: checkbox }) },
  async (ctx, input) => setMessageHidden(ctx, input),
);
