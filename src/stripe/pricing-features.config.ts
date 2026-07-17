export interface PlanConfig {
  displayName: string
  popular: boolean
  features: string[]
}

export const PRICING_FEATURES: Record<string, PlanConfig> = {
  FORGE: {
    displayName: 'Forge',
    popular: false,
    features: [
      '15-day free trial',
      'Up to 1 application per day',
      'AI resume review',
      'AI-generated cover letters',
      'AI job matching',
      'AI-submitted applications',
      '1 target role · 1 location',
      'Community support',
    ],
  },

  LAUNCH: {
    displayName: 'Launch',
    popular: true,
    features: [
      'Up to 10 targeted applications per day',
      'AI + recruiter resume optimization',
      'Tailored cover letters when needed',
      'Curated job matching',
      'Fully managed applications',
      'Up to 2 target roles · 3 locations',
      'LinkedIn profile optimization',
      'AI mock interviews',
      'Weekly search refinement',
      'Priority support',
    ],
  },

  MOMENTUM: {
    displayName: 'Momentum',
    popular: false,
    features: [
      'Complete targeted market coverage',
      'Multiple role-specific resumes',
      'Premium cover letter tailoring',
      'Priority curated job matching',
      'Priority managed applications',
      'Multiple related roles · nationwide locations',
      'Premium LinkedIn optimization',
      'Advanced interview coaching',
      'Continuous search optimization',
      'Dedicated support',
    ],
  },

}
