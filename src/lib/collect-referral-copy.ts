// 공개 추천 순위판 문구 — 등록 폼과 같은 4개 언어(폼 언어를 따른다).

const KO = {
  title: "친구 초대 순위",
  subtitle: "내 초대 링크로 등록한 친구 수예요.",
  searchTitle: "내 순위 찾기",
  searchHelp: "등록할 때 쓴 이름과 연락처 뒤 4자리를 넣으세요.",
  name: "이름",
  last4: "연락처 뒤 4자리",
  search: "찾기",
  searching: "찾는 중…",
  rank: "{rank}위",
  people: "{n}명",
  rewarded: "혜택 대상",
  meFound: "{label} 님은 지금 {rank}위예요. 친구 {n}명이 등록했어요.",
  meZero: "등록은 확인됐어요. 아직 내 링크로 등록한 친구가 없어요.",
  notFound: "이름과 연락처 뒤 4자리가 맞는 등록을 찾지 못했어요.",
  tooMany: "잠시 후 다시 시도해 주세요.",
  empty: "아직 추천으로 등록한 사람이 없어요.",
  more: "아래 순위는 검색으로 확인할 수 있어요.",
  totals: "추천한 사람 {a}명 · 추천으로 등록 {b}명",
  updated: "실시간 집계",
};
type Copy = typeof KO;

const EN: Copy = {
  title: "Referral ranking",
  subtitle: "Friends who registered with each person's invite link.",
  searchTitle: "Find my rank",
  searchHelp: "Enter the name you registered with and the last 4 digits of your phone number.",
  name: "Name",
  last4: "Last 4 digits of phone",
  search: "Find",
  searching: "Searching…",
  rank: "#{rank}",
  people: "{n}",
  rewarded: "Reward",
  meFound: "{label}, you're #{rank} — {n} friends registered with your link.",
  meZero: "We found your registration. No friends have registered with your link yet.",
  notFound: "We couldn't find a registration with that name and phone number.",
  tooMany: "Please try again in a moment.",
  empty: "No one has registered through a referral yet.",
  more: "Search to see ranks further down.",
  totals: "{a} referrers · {b} registrations via referral",
  updated: "Live",
};

const FR: Copy = {
  title: "Classement des parrainages",
  subtitle: "Amis inscrits grâce au lien d'invitation de chacun.",
  searchTitle: "Trouver mon rang",
  searchHelp: "Saisissez le nom utilisé à l'inscription et les 4 derniers chiffres de votre téléphone.",
  name: "Nom",
  last4: "4 derniers chiffres du téléphone",
  search: "Rechercher",
  searching: "Recherche…",
  rank: "{rank}e",
  people: "{n}",
  rewarded: "Récompense",
  meFound: "{label}, vous êtes {rank}e — {n} amis se sont inscrits avec votre lien.",
  meZero: "Inscription trouvée. Aucun ami ne s'est encore inscrit avec votre lien.",
  notFound: "Aucune inscription ne correspond à ce nom et à ce numéro.",
  tooMany: "Veuillez réessayer dans un instant.",
  empty: "Personne ne s'est encore inscrit via un parrainage.",
  more: "Recherchez pour voir les rangs suivants.",
  totals: "{a} parrains · {b} inscriptions par parrainage",
  updated: "En direct",
};

const JA: Copy = {
  title: "友だち招待ランキング",
  subtitle: "それぞれの招待リンクから登録した友だちの数です。",
  searchTitle: "自分の順位を探す",
  searchHelp: "登録時のお名前と電話番号の下4桁を入力してください。",
  name: "お名前",
  last4: "電話番号の下4桁",
  search: "探す",
  searching: "検索中…",
  rank: "{rank}位",
  people: "{n}人",
  rewarded: "特典対象",
  meFound: "{label} さんは現在{rank}位です。友だち{n}人が登録しました。",
  meZero: "登録を確認しました。まだあなたのリンクから登録した友だちはいません。",
  notFound: "お名前と電話番号の下4桁が一致する登録が見つかりませんでした。",
  tooMany: "しばらくしてからもう一度お試しください。",
  empty: "まだ紹介で登録した人はいません。",
  more: "下の順位は検索で確認できます。",
  totals: "紹介した人 {a}人 · 紹介で登録 {b}人",
  updated: "リアルタイム集計",
};

export type ReferralBoardCopy = Copy;

export function referralBoardCopy(locale: string | undefined): Copy {
  const base = (locale ?? "").toLowerCase().split(/[-_]/)[0];
  return base === "ko" ? KO : base === "fr" ? FR : base === "ja" ? JA : EN;
}

export const fill = (text: string, vars: Record<string, string | number>) =>
  text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
