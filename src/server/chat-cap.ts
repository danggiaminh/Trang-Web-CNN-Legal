// ---------------------------------------------------------------------------
// Trần số câu hỏi được gọi model trong 24 giờ, tính trên MỘT instance
//
// Endpoint chat không có đăng nhập, Origin ngoài trình duyệt giả được, còn giới hạn tần suất thì
// khoá theo IP: script đổi IP liên tục vẫn đốt credit OpenRouter thoải mái. Trần này đếm mọi câu
// hỏi thật sự đi tới model (câu vô nghĩa, câu bị chặn trước đó không tính) trong 24 giờ trượt,
// không phụ thuộc vào bất cứ thứ gì client khai báo.
//
// Cũng như trần Tavily trong guard.ts, sổ này nằm trong bộ nhớ từng instance Vercel: nhiều
// instance thì trần thực tế là cap × số instance, instance nguội thì đếm lại từ đầu. Nó thu hẹp
// thiệt hại chứ không chặn tuyệt đối — trần cứng phải đặt ở hạn mức credit của khoá OpenRouter.
// ---------------------------------------------------------------------------

/** Đặt rộng tay: mục đích là chặn script đốt tiền, không phải hạn chế người đọc thật. */
export const CHAT_DAILY_CAP = 600;
const WINDOW_MS = 24 * 60 * 60 * 1000;

export interface TurnCap {
  /** Giữ chỗ cho một câu hỏi; false khi 24 giờ qua đã đủ trần. */
  take(): boolean;
}

export function createTurnCap(limit: number, now: () => number = Date.now): TurnCap {
  // Mốc thời gian của từng lượt đã cho qua, cũ nhất ở đầu. Tối đa `limit` phần tử.
  const stamps: number[] = [];
  let warnedAt = Number.NEGATIVE_INFINITY;
  return {
    take() {
      const t = now();
      while (stamps.length && t - stamps[0]! >= WINDOW_MS) stamps.shift();
      if (stamps.length < limit) {
        stamps.push(t);
        return true;
      }
      // Báo một lần khi vừa chạm trần (rồi tối đa mỗi 24 giờ một lần), không thì bị dội log
      // đúng lúc đang bị đốt tiền.
      if (t - warnedAt >= WINDOW_MS) {
        warnedAt = t;
        console.warn(`[api/v1/chat] chạm trần ${limit} câu hỏi gọi model trong 24 giờ trên instance này`);
      }
      return false;
    },
  };
}

export const chatTurnCap = createTurnCap(CHAT_DAILY_CAP);
