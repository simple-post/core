/** Reviewed prompts for the in-app selector and directory/demo assets. No live writes without approval. */
export const STARTER_PROMPTS = [
  {
    id: "first-draft",
    title: "Prepare my first post",
    prompt:
      "List my connected SimplePost accounts. Help me turn an idea into a post for one account, ask for any missing details, save it as a draft, and show the preview. Wait for my confirmation before scheduling or publishing.",
  },
  {
    id: "platform-versions",
    title: "Adapt one idea for X and LinkedIn",
    prompt:
      "List my SimplePost accounts. Turn this idea into an X post and a LinkedIn post: [your idea]. Ask me to choose the accounts if needed. Save the versions as drafts and show their previews. Do not schedule or publish them yet.",
  },
  {
    id: "instagram",
    title: "Prepare an Instagram post",
    prompt:
      "List my SimplePost accounts and help me prepare an Instagram post using my caption and image. Ask for any missing media or account details. Save it as a draft, show its preview, and explain any validation errors. Wait for my confirmation before scheduling or publishing.",
  },
  {
    id: "weekly-calendar",
    title: "Review next week's schedule",
    prompt:
      "Show my SimplePost schedule for next week. Ask for my timezone if you do not know it. Show the scheduled posts and available slots, and help me plan drafts for the gaps. Do not create or change a schedule until I confirm it.",
  },
] as const;
