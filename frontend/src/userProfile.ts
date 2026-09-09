export interface UserProfileData {
  income: string;
  experience: string;
  risk: string;
  drawdown: string;
  horizon: string;
  goal: string;
  liquidity: string;
  supplement: string;
  interests: string[];
  updatedAt: string | null;
}

const EMPTY_USER_PROFILE: UserProfileData = {
  income: "未填写",
  experience: "未填写",
  risk: "均衡",
  drawdown: "约 10%",
  horizon: "1-3 年",
  goal: "长期成长",
  liquidity: "适中",
  supplement: "",
  interests: [],
  updatedAt: null,
};

export function loadUserProfile(): UserProfileData {
  try {
    const stored = localStorage.getItem("finmate.user-profile.v1");
    return stored ? { ...EMPTY_USER_PROFILE, ...JSON.parse(stored) } : EMPTY_USER_PROFILE;
  } catch {
    return EMPTY_USER_PROFILE;
  }
}

export function updateProfileFromConversation(profile: UserProfileData, question: string) {
  const dictionary = [
    "存储芯片", "半导体", "人工智能", "算力", "机器人", "银行", "证券", "保险",
    "医药", "创新药", "新能源", "光伏", "锂电池", "军工", "消费", "白酒", "有色金属",
    "黄金", "通信", "汽车", "房地产", "传媒", "航运", "煤炭", "低空经济",
  ];
  const found = dictionary.filter((topic) => question.includes(topic));
  if (!found.length) return profile;
  return {
    ...profile,
    interests: [...found, ...profile.interests.filter((topic) => !found.includes(topic))].slice(0, 8),
    updatedAt: new Date().toISOString(),
  };
}
