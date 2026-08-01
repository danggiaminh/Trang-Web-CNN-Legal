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
      "Tham gia bào chữa trong các vụ án hình sự, với trọng tâm là các vụ án về kinh tế, ngân hàng và đầu tư.",
    description:
      "Bào chữa hình sự không chỉ là tranh luận tại tòa — mà bắt đầu từ việc hiểu đúng vụ việc, xác định rõ vai trò và hoàn cảnh của từng bị cáo, và chuẩn bị kỹ lưỡng ở mọi giai đoạn tố tụng. CNN Legal tiếp cận mỗi vụ án với thái độ thực tế — không phóng đại khả năng, nhưng bảo vệ quyền lợi hợp pháp của khách hàng đến cùng.",
    situations: [
      "Bào chữa tại phiên tòa sơ thẩm và phúc thẩm",
      "Tư vấn pháp lý từ giai đoạn điều tra, truy tố",
      "Bào chữa trong các vụ án về kinh tế, ngân hàng và đầu tư",
      "Phân tích tình tiết giảm nhẹ và xây dựng hồ sơ bào chữa",
      "Tư vấn khi bị triệu tập lấy lời khai hoặc khởi tố bị can",
      "Hỗ trợ bị cáo người nước ngoài trong các vụ án có yếu tố đặc thù",
    ],
  },
  {
    slug: "tranh-tung-dan-su-thuong-mai",
    title: "Tranh tụng dân sự, kinh doanh, thương mại & hành chính",
    summary:
      "Đại diện và bảo vệ quyền, lợi ích hợp pháp của khách hàng trong quá trình giải quyết tranh chấp tại Tòa án và Trọng tài.",
    description:
      "Tranh chấp có thể phát sinh từ bất kỳ giao dịch nào — hợp đồng thuê mặt bằng, vay mượn, mua bán tài sản, quan hệ nội bộ doanh nghiệp hay quyết định hành chính của cơ quan nhà nước. CNN Legal giúp khách hàng hiểu rõ quyền lợi của mình, đánh giá thực tế tình huống và theo đuổi vụ việc tại Tòa án hoặc Trọng tài — không hứa hẹn kết quả, nhưng luôn nói thẳng những gì có thể và không thể làm được.",
    situations: [
      "Đại diện tranh tụng tại Tòa án và Trọng tài thương mại",
      "Tranh chấp hợp đồng thuê mặt bằng, mua bán tài sản",
      "Tranh chấp vay mượn, đặt cọc, tài sản chung",
      "Bồi thường thiệt hại ngoài hợp đồng",
      "Khiếu kiện quyết định hành chính, hành vi hành chính",
      "Hỗ trợ hòa giải và khởi kiện tại tòa",
    ],
  },
  {
    slug: "dat-dai-bat-dong-san",
    title: "Đàm phán, giải quyết tranh chấp đất đai & bất động sản",
    summary:
      "Đại diện và bảo vệ quyền, lợi ích hợp pháp của khách hàng trong các tranh chấp về đất đai và bất động sản.",
    description:
      "Tranh chấp đất đai thường kéo dài và phức tạp hơn nhiều so với ban đầu — đặc biệt khi giá đất tăng cao tạo động cơ để một bên phủ nhận ý chí ban đầu của giao dịch. CNN Legal giúp khách hàng nhận diện rủi ro pháp lý từ sớm, hiểu rõ bản chất giao dịch và chuẩn bị phương án xử lý thực tế nhất — ưu tiên đàm phán trước khi đưa vụ việc ra tòa.",
    situations: [
      "Đàm phán, thương lượng trước khi khởi kiện",
      "Tranh chấp chuyển nhượng quyền sử dụng đất",
      "Giao dịch chuyển nhượng để cấn trừ nợ và rủi ro vô hiệu hóa",
      "Bồi thường, hỗ trợ tái định cư khi bị thu hồi đất",
      "Tư vấn pháp lý trước khi ký hợp đồng mua bán, chuyển nhượng",
      "Phân tích rủi ro trong các dự án bất động sản có tranh chấp",
    ],
  },
  {
    slug: "tu-van-dau-tu-doanh-nghiep",
    title: "Tư vấn đầu tư, doanh nghiệp và hợp đồng",
    summary:
      "Tư vấn pháp lý cho doanh nghiệp trong hoạt động đầu tư, quản trị doanh nghiệp, đàm phán và soạn thảo hợp đồng.",
    description:
      "Phần lớn tranh chấp của doanh nghiệp bắt nguồn từ những điều khoản chưa được cân nhắc kỹ lúc ký kết. CNN Legal đồng hành với doanh nghiệp ngay từ giai đoạn chuẩn bị đầu tư và soạn thảo hợp đồng — nhận diện rủi ro trước khi nó trở thành vụ kiện, và tư vấn dựa trên nền tảng am hiểu cả quy định trong nước lẫn thông lệ quốc tế.",
    situations: [
      "Tư vấn thủ tục đầu tư và lựa chọn hình thức pháp lý",
      "Tư vấn quản trị doanh nghiệp, quan hệ cổ đông và người quản lý",
      "Đàm phán, soạn thảo và rà soát hợp đồng trước khi ký kết",
      "Phân tích rủi ro pháp lý trong hợp đồng có yếu tố nước ngoài",
      "Tư vấn tuân thủ pháp luật Việt Nam cho doanh nghiệp nước ngoài",
      "Tư vấn phòng ngừa rủi ro hình sự cho doanh nghiệp và người quản lý",
    ],
  },
] as const satisfies readonly Service[];
