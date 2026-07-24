export type CaseSource = {
  readonly name: string;
  readonly url: string;
};

export type NotableCase = {
  readonly slug: string;
  readonly title: string;
  readonly court: string;
  readonly date: string;
  readonly year: number;
  readonly role: string;
  readonly defendant: string;
  readonly charge: string;
  readonly category: string;
  readonly summary: string;
  readonly body: string;
  readonly keyArguments: readonly string[];
  readonly result?: string;
  readonly sources: readonly CaseSource[];
};

export const notableCases: readonly NotableCase[] = [
  {
    slug: "tham-o-tai-san-k-center-k-dentist",
    title:
      'Vụ án "Tham ô tài sản" xảy ra tại Công ty Cổ phần K Center - Phòng khám nha khoa K Dentist',
    court: "TAND khu vực 4 - TP.HCM",
    date: "",
    year: 2026,
    role: "",
    defendant: "",
    charge: "",
    category: "Hình sự",
    summary:
      'Luật sư Đặng Kim Chinh nêu ý kiến pháp lý trên báo chí về vụ hai người lao động tại một phòng khám nha khoa ở Thành phố Hồ Chí Minh bị truy tố về tội "Tham ô tài sản" do giữ 37,5 triệu đồng tiền thu của khách hàng, đặt vấn đề về khả năng vận dụng tình tiết giảm nhẹ "người bị hại cũng có lỗi" trong khu vực tư nhân. Ngày 30/6/2026, tòa xét xử lại tuyên phạt hai bị cáo 7 năm 6 tháng tù và 2 năm 6 tháng tù.',
    body: `<h2>Nội dung vụ án</h2>
<p>Hai bị cáo Phan Ngọc Thanh Tâm và Châu Văn Sang làm việc tại một phòng khám nha khoa tại Thành phố Hồ Chí Minh, không có hợp đồng lao động, bị truy tố về tội "Tham ô tài sản" theo Điều 353 Bộ luật Hình sự do giữ 37,5 triệu đồng tiền làm răng thu của khách hàng. Bản án sơ thẩm lần đầu của Tòa án nhân dân Quận 10 tuyên phạt bị cáo Tâm 8 năm tù, bị cáo Sang 7 năm tù. Tòa án nhân dân Thành phố Hồ Chí Minh xét xử phúc thẩm, hủy toàn bộ bản án để điều tra lại. Tại cáo trạng ban hành ngày 11/8/2025, bị cáo Tâm bị truy tố theo khoản 2 Điều 353 (khung hình phạt 7–15 năm tù), bị cáo Sang theo khoản 1 (khung hình phạt 2–7 năm tù).</p>

<h2>Ý kiến pháp lý</h2>
<p>Trên Báo Pháp luật Thành phố Hồ Chí Minh ngày 14/8/2025, Luật sư Đặng Kim Chinh đặt vấn đề về khả năng vận dụng tình tiết giảm nhẹ "người bị hại cũng có lỗi" đối với tội tham ô tài sản trong khu vực tư nhân, với ba luận điểm:</p>
<h3>Về thực trạng quản trị</h3>
<p>Không ít doanh nghiệp khu vực tư nhân, đặc biệt trong lĩnh vực dịch vụ và thương mại, duy trì quy trình quản lý dòng tiền thu từ khách hàng lỏng lẻo.</p>
<h3>Về hệ quả phân bổ rủi ro</h3>
<p>Thực trạng này đặt người lao động — phần lớn có thu nhập thấp và áp lực tài chính cao — vào môi trường rủi ro phạm tội. Khi vụ việc xảy ra, trách nhiệm hình sự và trách nhiệm dân sự dồn về phía người lao động, còn doanh nghiệp mặc nhiên giữ tư cách bị hại.</p>
<h3>Về bản chất lỗi của bị hại</h3>
<p>Doanh nghiệp là bị hại, nhưng doanh nghiệp do chủ sở hữu và người quản lý trực tiếp điều hành, kiểm soát. Nếu hành vi tạo sơ hở trong quản lý xuất phát từ ý chí chủ động và quyết định có chủ đích của chính chủ sở hữu hưởng lợi hoặc người quản lý, thì lỗi đó gắn trực tiếp với bị hại. Nói cách khác, lỗi của bị hại trong trường hợp này thực chất là lỗi do chính chủ sở hữu hưởng lợi hoặc người quản lý doanh nghiệp cố ý gây ra.</p>

<h2>Diễn biến tố tụng</h2>
<p>Ngày 30/6/2026, Tòa án nhân dân khu vực 4 — Thành phố Hồ Chí Minh xét xử lại, tuyên phạt bị cáo Phan Ngọc Thanh Tâm 7 năm 6 tháng tù và bị cáo Châu Văn Sang 2 năm 6 tháng tù.</p>`,
    keyArguments: [],
    result: undefined,
    sources: [],
  },
  {
    slug: "cuu-hieu-truong-tham-o-tai-san-ca-mau",
    title: "Vụ án cựu Hiệu trưởng bị cáo buộc tham ô tài sản ở Cà Mau",
    court: "TAND tỉnh Cà Mau",
    date: "",
    year: 2026,
    role: "",
    defendant: "",
    charge: "",
    category: "Hình sự",
    summary:
      "Luật sư Đặng Kim Chinh nêu ý kiến pháp lý trên báo chí về vụ ông Trần Văn Tâm — nguyên Hiệu trưởng Trường Trung học cơ sở Tam Giang Tây, tỉnh Cà Mau — bị cáo buộc tham ô 10,7 triệu đồng và bị tuyên 7 năm tù ở cấp sơ thẩm. Bản án sơ thẩm sau đó bị hủy để điều tra lại; ngày 28/5/2026, Cơ quan Cảnh sát điều tra đình chỉ điều tra bị can.",
    body: `<h2>Nội dung vụ án</h2>
<p>Ông Trần Văn Tâm, nguyên Hiệu trưởng Trường Trung học cơ sở Tam Giang Tây (huyện Ngọc Hiển cũ, tỉnh Cà Mau), bị cáo buộc trong năm học 2022–2023 đã tự mua vật tư và trực tiếp sửa chữa, chế tạo thiết bị phục vụ nhà trường, sau đó sử dụng hóa đơn của ba doanh nghiệp (lần lượt 11 triệu đồng, 3,45 triệu đồng và 3,45 triệu đồng) để thanh quyết toán. Phần chênh lệch 10,7 triệu đồng bị quy kết là tài sản chiếm đoạt. Tòa án nhân dân huyện Ngọc Hiển xét xử sơ thẩm ngày 17/02/2025, tuyên phạt 7 năm tù về tội "Tham ô tài sản".</p>

<h2>Ý kiến pháp lý</h2>
<p>Trên Báo Pháp luật Thành phố Hồ Chí Minh ngày 12/7/2025, Luật sư Đặng Kim Chinh phân tích ba vấn đề:</p>
<h3>Thứ nhất, về cách tính giá trị tài sản chiếm đoạt</h3>
<p>Bị cáo vừa giữ chức vụ quản lý, vừa trực tiếp bỏ công lao động sửa chữa, chế tạo thiết bị. Phần công lao động này cần được ghi nhận và tách bạch khi xác định giá trị tài sản bị chiếm đoạt, thay vì quy toàn bộ phần chênh lệch giữa hóa đơn và chi phí vật tư thành tài sản chiếm đoạt.</p>
<h3>Thứ hai, về việc xác định tình tiết giảm nhẹ</h3>
<p>Luật sư chỉ ra sự thiếu thống nhất giữa kết luận điều tra — vốn đề nghị áp dụng tình tiết "thành khẩn khai báo, ăn năn hối cải" theo điểm s khoản 1 Điều 51 Bộ luật Hình sự — và bản án sơ thẩm không ghi nhận tình tiết này.</p>
<h3>Thứ ba, về khả năng áp dụng Điều 54</h3>
<p>Nếu tình tiết giảm nhẹ nêu trên được ghi nhận đầy đủ, bị cáo hội đủ điều kiện để Hội đồng xét xử quyết định hình phạt dưới mức thấp nhất của khung hình phạt được áp dụng theo khoản 1 Điều 54 Bộ luật Hình sự.</p>

<h2>Diễn biến tố tụng</h2>
<p>Ngày 06/5/2025, Tòa án nhân dân tỉnh Cà Mau xét xử phúc thẩm, hủy toàn bộ bản án sơ thẩm để điều tra lại do vi phạm tố tụng: không đưa người đại diện theo pháp luật của nhà trường vào tham gia tố tụng để xác định thiệt hại. Ngày 16/8/2025, ông Tâm được thay đổi biện pháp ngăn chặn từ tạm giam sang bảo lĩnh, sau khi bị tạm giam từ ngày 15/8/2024. Ngày 28/5/2026, Cơ quan Cảnh sát điều tra Công an tỉnh Cà Mau ban hành kết luận điều tra và đình chỉ điều tra bị can đối với ông Trần Văn Tâm; quyết định được trao ngày 29/5/2026.</p>`,
    keyArguments: [],
    result: undefined,
    sources: [],
  },
  {
    slug: "dai-an-van-thinh-phat-giai-doan-2",
    title: "Đại án Vạn Thịnh Phát — Giai đoạn 2 (Phúc thẩm)",
    court: "TAND Cấp cao tại TP.HCM",
    date: "",
    year: 2025,
    role: "",
    defendant: "",
    charge: "",
    category: "Hình sự",
    summary:
      "Luật sư Đặng Kim Chinh là người bào chữa cho bị cáo Kwok Hakman Oliver — nguyên Tổng Giám đốc kiêm người đại diện theo pháp luật Công ty Cổ phần Tập đoàn Đầu tư An Đông — tại cấp phúc thẩm. Ngày 21/4/2025, Hội đồng xét xử phúc thẩm tuyên phạt bị cáo 3 năm 6 tháng tù, giảm 2 năm so với bản án sơ thẩm.",
    body: `<p>Bào chữa cho bị cáo Kwok Hakman Oliver, nguyên Tổng Giám đốc kiêm người đại diện theo pháp luật Công ty Cổ phần Tập đoàn Đầu tư An Đông</p>

<h2>Bối cảnh tố tụng</h2>
<p>Giai đoạn 2 vụ án tập trung vào hành vi phát hành trái phiếu doanh nghiệp. Tại bản án sơ thẩm ngày 17/10/2024, Tòa án nhân dân Thành phố Hồ Chí Minh tuyên phạt bị cáo Kwok Hakman Oliver (71 tuổi, quốc tịch Úc) 5 năm 6 tháng tù về tội "Lừa đảo chiếm đoạt tài sản". Bị cáo bị xác định đã ký toàn bộ hồ sơ, tài liệu hợp thức việc phát hành trái phiếu của Công ty An Đông năm 2018 với tư cách người đại diện theo pháp luật, giúp sức phát hành ba gói trái phiếu, chiếm đoạt 24.900 tỷ đồng của các bị hại. Bị cáo kháng cáo xin giảm nhẹ hình phạt.</p>

<h2>Phạm vi tham gia</h2>
<p>Luật sư Đặng Kim Chinh là người bào chữa cho bị cáo Kwok Hakman Oliver tại phiên phúc thẩm của Tòa án nhân dân Cấp cao tại Thành phố Hồ Chí Minh, trình bày phần bào chữa ngày 04/4/2025. Trước đó, ngày 03/4/2025, luật sư trực tiếp thẩm vấn bị cáo để làm rõ vị trí, vai trò, nhận thức và hoàn cảnh phạm tội.</p>

<h2>Nội dung bào chữa</h2>
<p>Luận điểm được ghi nhận rộng rãi nhất là đề nghị áp dụng tình tiết giảm nhẹ "phạm tội do lạc hậu" theo khoản 1 Điều 51 Bộ luật Hình sự — một tình tiết hiếm khi được viện dẫn đối với bị cáo là người nước ngoài. Luật sư lập luận rằng "lạc hậu" ở đây được hiểu là sự tụt hậu về nhận thức pháp luật: bị cáo sinh sống phần lớn cuộc đời ở nước ngoài, không tiếp thu kịp kiến thức pháp luật Việt Nam, đặc biệt là pháp luật chuyên ngành về phát hành trái phiếu doanh nghiệp — lĩnh vực mà hành vi sai phạm đã trở thành hành vi giúp sức trong chuỗi hành vi cấu thành tội lừa đảo chiếm đoạt tài sản bị quy kết.</p>
<p>Song song, luật sư đề nghị đánh giá lại vai trò của bị cáo trong vụ án đồng phạm: bị cáo phạm tội lần đầu, chỉ điều hành hoạt động thường nhật của Công ty Windsor và An Đông Plaza, không quản lý, điều hành hoạt động tài chính của Công ty An Đông, do đó có vai trò hạn chế trong việc phát hành trái phiếu. Về tình tiết giảm nhẹ mới phát sinh tại cấp phúc thẩm, luật sư trình bày việc bị cáo chủ động nộp thêm 500 triệu đồng (sau khi đã nộp 1 tỷ đồng ở cấp sơ thẩm), tham gia công tác phòng, chống dịch COVID-19 tại Thành phố Hồ Chí Minh và đóng góp xây dựng công trình phúc lợi, nhà tình thương.</p>

<h2>Kết quả tố tụng</h2>
<p>Ngày 21/4/2025, Hội đồng xét xử phúc thẩm tuyên phạt bị cáo Kwok Hakman Oliver 3 năm 6 tháng tù, giảm 2 năm so với bản án sơ thẩm.</p>`,
    keyArguments: [],
    result: undefined,
    sources: [
      {
        name: "Pháp Luật TP.HCM",
        url: "https://plo.vn/chi-tiet-muc-an-doi-voi-28-bi-cao-vu-van-thinh-phat-giai-doan-2-post845550.html",
      },
      {
        name: "Báo Tiền Phong",
        url: "https://tienphong.vn/luat-su-de-nghi-ap-dung-tinh-tiet-giam-nhe-pham-toi-do-lac-hau-cho-mot-dong-pham-cua-ba-truong-my-lan-post1731264.tpo",
      },
      {
        name: "VnExpress",
        url: "https://vnexpress.net/ba-truong-my-lan-duoc-giam-an-chung-than-xuong-30-nam-tu-4876576.html",
      },
    ],
  },
  {
    slug: "dai-an-van-thinh-phat-giai-doan-1",
    title: "Đại án Vạn Thịnh Phát — Giai đoạn 1 (Phúc thẩm)",
    court: "TAND Cấp cao tại TP.HCM",
    date: "",
    year: 2024,
    role: "",
    defendant: "",
    charge: "",
    category: "Hình sự",
    summary:
      "Luật sư Đặng Kim Chinh là người bào chữa cho bị cáo Lê Khánh Hiền — nguyên Tổng Giám đốc Ngân hàng TMCP Sài Gòn (SCB) — tại cấp phúc thẩm. Ngày 03/12/2024, Hội đồng xét xử phúc thẩm tuyên phạt bị cáo 3 năm tù, giảm 2 năm so với bản án sơ thẩm.",
    body: `<p>Bào chữa cho bị cáo Lê Khánh Hiền, nguyên Tổng Giám đốc Ngân hàng TMCP Sài Gòn (SCB)</p>

<h2>Bối cảnh tố tụng</h2>
<p>Giai đoạn 1 vụ án xảy ra tại Tập đoàn Vạn Thịnh Phát và Ngân hàng SCB được Tòa án nhân dân Thành phố Hồ Chí Minh xét xử sơ thẩm từ ngày 05/3 đến ngày 11/4/2024 đối với 86 bị cáo. Bị cáo Lê Khánh Hiền bị Hội đồng xét xử sơ thẩm tuyên phạt 5 năm tù về tội "Vi phạm quy định về cho vay trong hoạt động của các tổ chức tín dụng". Bị cáo kháng cáo xin giảm nhẹ hình phạt. Tòa án nhân dân Cấp cao tại Thành phố Hồ Chí Minh mở phiên phúc thẩm vào tháng 11/2024.</p>

<h2>Phạm vi tham gia</h2>
<p>Luật sư Đặng Kim Chinh (Đoàn Luật sư Thành phố Hồ Chí Minh) là người bào chữa cho bị cáo Lê Khánh Hiền tại cấp phúc thẩm. Tư cách này được các cơ quan báo chí ghi nhận trực tiếp tại phiên tòa ngày 06/11/2024.</p>

<h2>Nội dung bào chữa</h2>
<p>Luật sư trình bày trước Hội đồng xét xử rằng thân chủ thuộc một trường hợp cần được xem xét riêng biệt: Ngân hàng SCB đã có công văn gửi Hội đồng xét xử ghi nhận bị cáo có thành tích trong đề án tái cơ cấu ngân hàng, cụ thể là góp phần ổn định tính thanh khoản và hiện đại hóa hệ thống công nghệ thông tin của SCB. Đây là căn cứ thực tế gắn với nhóm tình tiết giảm nhẹ về thành tích trong công tác theo khoản 1 Điều 51 Bộ luật Hình sự. Về nhân thân và thái độ khắc phục, luật sư trình bày việc bị cáo tiếp tục vận động gia đình khắc phục hậu quả sau phiên tòa sơ thẩm. Bản thân bị cáo khai giữ chức vụ Tổng Giám đốc SCB trong 11 tháng, trong bối cảnh ngân hàng đang khủng hoảng, và nghỉ việc sau khi hoàn thành tái cơ cấu giai đoạn 1.</p>

<h2>Kết quả tố tụng</h2>
<p>Ngày 03/12/2024, Hội đồng xét xử phúc thẩm tuyên phạt bị cáo Lê Khánh Hiền 3 năm tù, giảm 2 năm so với bản án sơ thẩm.</p>`,
    keyArguments: [],
    result: undefined,
    sources: [
      {
        name: "Báo Tiền Phong",
        url: "https://tienphong.vn/phuc-tham-dai-an-van-thinh-phat-luat-su-trinh-bay-ve-truong-hop-dac-biet-cua-mot-bi-cao-post1689183.tpo",
      },
    ],
  },
  {
    slug: "buon-lau-xang-dau-200-trieu-lit",
    title: "Vụ buôn lậu gần 200 triệu lít xăng dầu (Phúc thẩm)",
    court: "TAND Cấp cao tại TP.HCM",
    date: "",
    year: 2023,
    role: "",
    defendant: "",
    charge: "",
    category: "Hình sự",
    summary:
      "Luật sư Đặng Kim Chinh tham gia bào chữa tại phiên tòa phúc thẩm vụ án buôn lậu hơn 198 triệu lít xăng từ Singapore về Việt Nam, trị giá hơn 2.596 tỷ đồng, với 74 bị cáo bị xét xử sơ thẩm tại Tòa án nhân dân tỉnh Đồng Nai.",
    body: `<h2>Bối cảnh tố tụng</h2>
<p>Từ tháng 3/2020 đến tháng 2/2021, nhóm bị cáo do Phan Thanh Hữu và Đào Ngọc Viễn cầm đầu sử dụng tàu Pacific Ocean (trọng tải 3.000 tấn) và Western Sea (trọng tải 5.000 tấn) thực hiện 48 chuyến vận chuyển xăng nhập lậu từ Singapore về Việt Nam, tổng cộng hơn 198 triệu lít, trị giá hơn 2.596 tỷ đồng. Tòa án nhân dân tỉnh Đồng Nai xét xử sơ thẩm 74 bị cáo. Tòa án nhân dân Cấp cao tại Thành phố Hồ Chí Minh mở phiên phúc thẩm từ tháng 3/2023, ban hành Bản án hình sự phúc thẩm số 205/2023/HS-PT ngày 17/4/2023, trong đó giảm án cho bị cáo Phan Thanh Hữu từ 17 năm xuống 13 năm tù và tuyên bị cáo Đào Ngọc Viễn 15 năm tù về tội "Buôn lậu".</p>

<h2>Phạm vi tham gia</h2>
<p>Luật sư Đặng Kim Chinh tham gia bào chữa tại phiên tòa phúc thẩm này.</p>

<h2>Diễn biến tố tụng về sau</h2>
<p>Năm 2024, Hội đồng Thẩm phán Tòa án nhân dân Tối cao xét xử giám đốc thẩm, nhận định việc hai cấp tòa chỉ áp dụng hình phạt tiền là hình phạt chính đối với 10 bị cáo là chủ doanh nghiệp — trong khi những người giúp sức có vai trò nhẹ hơn lại bị áp dụng hình phạt tù — là sai lầm trong việc áp dụng pháp luật, chưa bảo đảm nguyên tắc phân hóa trách nhiệm hình sự trong đồng phạm. Trên cơ sở đó, Hội đồng giám đốc thẩm hủy một phần bản án phúc thẩm và một phần bản án sơ thẩm để xét xử sơ thẩm lại theo hướng không áp dụng hình phạt chính là phạt tiền.</p>

<h2>Phạm vi tài liệu</h2>
<p>Việc Luật sư Đặng Kim Chinh tham gia bào chữa tại phiên phúc thẩm tháng 3/2023 được ghi nhận trong hồ sơ nghề nghiệp của luật sư. Phiên tòa có 43 luật sư tham gia bào chữa; các bài báo tường thuật hiện tiếp cận được không nêu tên từng người bào chữa, do đó danh tính bị cáo được luật sư bào chữa trong vụ án này chưa được xác định qua nguồn công khai. Nội dung quan điểm bào chữa vì vậy không được trình bày tại bài viết này.</p>`,
    keyArguments: [],
    sources: [
      {
        name: "Báo Lao Động",
        url: "https://laodong.vn/phap-luat/an-ninh-that-chat-tai-phien-phuc-tham-vu-buon-lau-200-trieu-lit-xang-dau-1157100.ldo",
      },
    ],
  },
];
