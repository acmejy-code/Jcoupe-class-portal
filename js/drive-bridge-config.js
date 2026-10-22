// 수행평가2 추가자료 Google Drive Bridge 설정
// Google Apps Script를 웹 앱으로 배포한 뒤 /exec URL을 아래에 붙여넣으세요.
export const DRIVE_BRIDGE_CONFIG = {
  webAppUrl: "https://script.google.com/macros/s/AKfycbzwf4mStl7qK5PYR0Rk7JCcW-OnN5J9A_tnblW25D8oGAFyc-JrJEmDN4cpaibQ2r-E/exec"
};

export function isDriveBridgeConfigured(){
  const url=String(DRIVE_BRIDGE_CONFIG.webAppUrl||"").trim();
  return /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec(?:\?.*)?$/i.test(url);
}
