export type TopicGuardBlockCategory =
  | "off_topic_general"
  | "off_topic_technical"
  | "off_topic_sensitive"
  | "jailbreak";

export type TopicGuardAllowCategory = "shopping" | "greeting";

export type TopicGuardCategory =
  | TopicGuardAllowCategory
  | TopicGuardBlockCategory;

export type TopicGuardSource = "classifier" | "disabled";

export type TopicGuardDecision =
  | {
      allowed: true;
      category: TopicGuardAllowCategory;
      source: TopicGuardSource;
      reason: string;
      /** When set, skip the main model and stream this text directly. */
      cannedResponse?: string;
    }
  | {
      allowed: false;
      category: TopicGuardBlockCategory;
      source: TopicGuardSource;
      reason: string;
      userMessage: string;
    };

export type TopicGuardMetaV1 = {
  version: 1;
  blocked: boolean;
  category: TopicGuardCategory;
  source: TopicGuardSource;
  reason: string;
};
