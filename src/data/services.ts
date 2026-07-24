export type Service = {
  readonly slug: string;
  readonly title: string;
  readonly summary: string;
  readonly description: string;
  readonly situations: readonly string[];
};

export const services = [
  {
    slug: "bao-chua-hinh-su",
    title: "Bào chữa hình sự",
    summary:
      "Trực tiếp bào chữa tại tòa trong các vụ án hình sự, từ tội phạm kinh tế đến các vụ án phức tạp có yếu tố đặc thù.",
    description:
      "Bào chữa hình sự không chỉ là tranh luận tại tòa — mà bắt đầu từ việc hiểu đúng vụ việc, xác định rõ vai trò và hoàn cảnh của từng bị cáo, và chuẩn bị kỹ lưỡng ở mọi giai đoạn tố tụng. CNN Legal tiếp cận mỗi vụ án với thái độ thực tế — không phóng đại khả năng, nhưng bảo vệ quyền lợi hợp pháp của khách hàng đến cùng.",
    situations: [
      "Bào chữa tại phiên tòa sơ thẩm và phúc thẩm",
      "Tư vấn pháp lý từ giai đoạn điều tra, truy tố",
      "Phân tích tình tiết giảm nhẹ và xây dựng hồ sơ bào chữa",
      "Bào chữa trong các vụ án kinh tế, tham nhũng, chức vụ",
      "Hỗ trợ bị cáo người nước ngoài trong các vụ án có yếu tố đặc thù",
    ],
  },
  {
    slug: "tu-van-phap-ly-hinh-su",
    title: "Tư vấn pháp lý hình sự",
    summary:
      "Phân tích hồ sơ, đánh giá tình tiết, tư vấn chiến lược xử lý trước và trong quá trình tố tụng.",
    description:
      "Không phải vụ việc nào cũng cần đến phiên tòa — nhưng mọi vụ việc đều cần được hiểu đúng ngay từ đầu. Khi bị triệu tập, khởi tố hoặc đối mặt với nguy cơ bị truy cứu trách nhiệm hình sự, việc có được tư vấn pháp lý kịp thời và thực tế có thể tạo ra sự khác biệt lớn. CNN Legal giúp khách hàng hiểu rõ tình huống của mình và chuẩn bị phương án ứng phó phù hợp.",
    situations: [
      "Tư vấn khi bị triệu tập lấy lời khai hoặc khởi tố bị can",
      "Đánh giá dấu hiệu hình sự trong các tranh chấp dân sự, kinh tế",
      "Phân tích cấu thành tội phạm và khả năng miễn, giảm trách nhiệm hình sự",
      "Tư vấn phòng ngừa rủi ro hình sự cho cá nhân và doanh nghiệp",
      "Hỗ trợ xây dựng hồ sơ giảm nhẹ, bồi thường khắc phục hậu quả",
    ],
  },
  {
    slug: "dat-dai-bat-dong-san",
    title: "Đất đai & Bất động sản",
    summary:
      "Tư vấn tranh chấp chuyển nhượng quyền sử dụng đất, bồi thường giải phóng mặt bằng, cơ chế thu hồi đất.",
    description:
      "Tranh chấp đất đai thường kéo dài và phức tạp hơn nhiều so với ban đầu — đặc biệt khi giá đất tăng cao tạo động cơ để một bên phủ nhận ý chí ban đầu của giao dịch. CNN Legal giúp khách hàng nhận diện rủi ro pháp lý từ sớm, hiểu rõ bản chất giao dịch và chuẩn bị phương án xử lý thực tế nhất.",
    situations: [
      "Tranh chấp chuyển nhượng quyền sử dụng đất",
      "Giao dịch chuyển nhượng để cấn trừ nợ và rủi ro vô hiệu hóa",
      "Bồi thường, hỗ trợ tái định cư khi bị thu hồi đất",
      "Tư vấn pháp lý trước khi ký hợp đồng mua bán, chuyển nhượng",
      "Phân tích rủi ro trong các dự án bất động sản có tranh chấp",
    ],
  },
  {
    slug: "dan-su-hop-dong",
    title: "Dân sự & Hợp đồng",
    summary:
      "Tư vấn và tranh tụng trong các tranh chấp dân sự, hợp đồng thuê mặt bằng, hợp đồng thương mại.",
    description:
      "Tranh chấp dân sự có thể phát sinh từ bất kỳ giao dịch nào — hợp đồng thuê mặt bằng, vay mượn, mua bán tài sản hay bồi thường thiệt hại. CNN Legal giúp khách hàng hiểu rõ quyền lợi của mình, đánh giá thực tế tình huống và tìm hướng xử lý phù hợp — không hứa hẹn kết quả, nhưng luôn nói thẳng những gì có thể và không thể làm được.",
    situations: [
      "Tranh chấp hợp đồng thuê mặt bằng, mua bán tài sản",
      "Bồi thường thiệt hại ngoài hợp đồng",
      "Tranh chấp vay mượn, đặt cọc, tài sản chung",
      "Tư vấn soạn thảo và rà soát hợp đồng dân sự trước khi ký kết",
      "Hỗ trợ hòa giải và khởi kiện dân sự tại tòa",
    ],
  },
  {
    slug: "thuong-mai-quoc-te",
    title: "Thương mại Quốc tế",
    summary:
      "Tư vấn thư tín dụng L/C, hợp đồng mua bán hàng hóa quốc tế, trọng tài đầu tư quốc tế.",
    description:
      "Các giao dịch thương mại quốc tế đặt ra những vấn đề pháp lý mà pháp luật trong nước không phải lúc nào cũng có câu trả lời rõ ràng. CNN Legal tư vấn dựa trên nền tảng am hiểu cả quy định Việt Nam lẫn thông lệ quốc tế — giúp khách hàng nhận diện rủi ro trước khi ký kết và bảo vệ quyền lợi khi tranh chấp phát sinh.",
    situations: [
      "Tư vấn và xử lý tranh chấp thư tín dụng L/C trong thanh toán quốc tế",
      "Phân tích điều khoản và pháp luật áp dụng trong hợp đồng mua bán hàng hóa quốc tế",
      "Tư vấn trọng tài đầu tư quốc tế và giải quyết tranh chấp xuyên biên giới",
      "Phân tích rủi ro pháp lý trong hợp đồng có yếu tố nước ngoài trước khi ký kết",
      "Tư vấn tuân thủ pháp luật Việt Nam cho doanh nghiệp nước ngoài",
    ],
  },
  {
    slug: "nghien-cuu-tu-van-chinh-sach-phap-luat",
    title: "Chính sách & Nghiên cứu Pháp luật",
    summary:
      "Đóng góp ý kiến pháp lý cho dự thảo luật, viết bài chuyên ngành được đăng tại Thư viện Quốc hội và các tạp chí pháp lý hàng đầu.",
    description:
      "Bên cạnh hoạt động tranh tụng, CNN Legal dành thời gian nghiên cứu và đóng góp vào quá trình hoàn thiện pháp luật. Các phân tích chính sách đã được đăng tải tại Thư viện Quốc hội và Tạp chí Luật sư Việt Nam — không phải để quảng bá, mà vì đây là cách chúng tôi hiểu pháp luật sâu hơn và phục vụ khách hàng tốt hơn.",
    situations: [
      "Phân tích và phản biện dự thảo Bộ luật Hình sự sửa đổi",
      "Nghiên cứu về hình phạt, dẫn độ và hợp tác tư pháp quốc tế",
      "Bình luận án lệ và thực tiễn tố tụng",
      "Tư vấn chính sách pháp lý cho doanh nghiệp đổi mới sáng tạo",
      "Tư vấn pháp lý cho tổ chức, hiệp hội nghề nghiệp",
    ],
  },
] as const satisfies readonly Service[];
