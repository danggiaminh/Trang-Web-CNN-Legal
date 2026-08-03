export type CaseSource = {
  readonly name: string;
  readonly url: string;
  readonly title: string;
  readonly publishedAt: string;
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
    slug: "dai-an-van-thinh-phat-giai-doan-2",
    title: "Đại án Vạn Thịnh Phát — Giai đoạn 2",
    court: "Tòa án nhân dân Cấp cao tại TP.HCM",
    date: "21/04/2025",
    year: 2025,
    role: "",
    defendant: "",
    charge: "",
    category: "Hình sự",
    summary:
      "Luật sư Đặng Kim Chinh là người bào chữa cho bị cáo Kwok Hakman Oliver — nguyên Tổng Giám đốc kiêm người đại diện theo pháp luật Công ty Cổ phần Tập đoàn Đầu tư An Đông — tại cấp phúc thẩm. Ngày 21/4/2025, Hội đồng xét xử phúc thẩm tuyên phạt bị cáo 3 năm 6 tháng tù, giảm 2 năm so với bản án sơ thẩm.",
    body: `<h2>Bối cảnh tố tụng</h2>
<p>Giai đoạn 2 vụ án tập trung vào hành vi phát hành trái phiếu doanh nghiệp. Tại bản án sơ thẩm ngày 17/10/2024, Tòa án nhân dân Thành phố Hồ Chí Minh tuyên phạt bị cáo Kwok Hakman Oliver (71 tuổi, quốc tịch Úc) 5 năm 6 tháng tù về tội "Lừa đảo chiếm đoạt tài sản". Bị cáo bị xác định đã ký toàn bộ hồ sơ, tài liệu hợp thức việc phát hành trái phiếu của Công ty An Đông năm 2018 với tư cách người đại diện theo pháp luật, giúp sức phát hành ba gói trái phiếu, chiếm đoạt 24.900 tỷ đồng của các bị hại. Bị cáo kháng cáo xin giảm nhẹ hình phạt.</p>

<h2>Phạm vi tham gia</h2>
<p>Luật sư Đặng Kim Chinh là người bào chữa cho bị cáo Kwok Hakman Oliver tại phiên phúc thẩm của Tòa án nhân dân Cấp cao tại Thành phố Hồ Chí Minh, trình bày phần bào chữa ngày 04/4/2025. Trước đó, ngày 03/4/2025, luật sư trực tiếp thẩm vấn bị cáo để làm rõ vị trí, vai trò, nhận thức và hoàn cảnh phạm tội.</p>

<h2>Nội dung bào chữa</h2>
<p>Luật sư Đặng Kim Chinh cũng trình bày trước Hội đồng xét xử rằng, bị cáo Kwok Hakman Oliver là người nước ngoài (quốc tịch Úc), theo lý lịch trong hồ sơ vụ án, bị cáo đã sinh sống 59 năm ở nước ngoài, chỉ khi tuổi già bị cáo mới đến Việt Nam làm việc và sinh sống. Với những khác biệt về ngôn ngữ, văn hoá, môi trường kinh doanh và pháp luật giữa Việt Nam và Úc nên bị cáo bị hạn chế khả năng nhận thức về pháp luật Việt Nam. Bị cáo thực hiện hành vi giúp sức cho các bị cáo khác mà không biết đó chính là hành vi phạm tội tại Việt Nam, mặc dù nguyên tắc của pháp luật hình sự Việt Nam buộc bị cáo phải biết.</p>
<p>Song song, luật sư đề nghị đánh giá lại vai trò của bị cáo trong vụ án đồng phạm: bị cáo phạm tội lần đầu, chỉ điều hành hoạt động thường nhật của Công ty Windsor và An Đông Plaza, không quản lý, điều hành hoạt động tài chính của Công ty An Đông, do đó có vai trò hạn chế trong việc phát hành trái phiếu. Về tình tiết giảm nhẹ mới phát sinh tại cấp phúc thẩm, luật sư trình bày việc bị cáo chủ động nộp thêm 500 triệu đồng (sau khi đã nộp 1 tỷ đồng ở cấp sơ thẩm), tham gia công tác phòng, chống dịch COVID-19 tại Thành phố Hồ Chí Minh và đóng góp xây dựng công trình phúc lợi, nhà tình thương.</p>

<h2>Kết quả tố tụng</h2>
<p>Ngày 21/4/2025, Hội đồng xét xử phúc thẩm tuyên phạt bị cáo Kwok Hakman Oliver 3 năm 6 tháng tù, giảm 2 năm so với bản án sơ thẩm.</p>`,
    keyArguments: [],
    result: undefined,
    sources: [
      {
        name: "Pháp Luật TP.HCM",
        url: "https://plo.vn/chi-tiet-muc-an-doi-voi-28-bi-cao-vu-van-thinh-phat-giai-doan-2-post845550.html",
        title: "Chi tiết mức án đối với 28 bị cáo vụ Vạn Thịnh Phát giai đoạn 2",
        publishedAt: "21/04/2025",
      },
      {
        name: "Báo Tin tức (TTXVN)",
        url: "https://baotintuc.vn/phap-luat/vu-an-van-thinh-phat-giai-doan-2-tuyen-an-doi-voi-cac-bi-cao-20241017092905474.htm",
        title: "Vụ án Vạn Thịnh Phát giai đoạn 2: Tuyên án đối với các bị cáo",
        publishedAt: "17/10/2024",
      },
      {
        name: "Báo Tiền Phong",
        url: "https://tienphong.vn/luat-su-de-nghi-ap-dung-tinh-tiet-giam-nhe-pham-toi-do-lac-hau-cho-mot-dong-pham-cua-ba-truong-my-lan-post1731264.tpo",
        title: "Luật sư đề nghị áp dụng tình tiết giảm nhẹ “phạm tội do lạc hậu” cho một đồng phạm của bà Trương Mỹ Lan",
        publishedAt: "05/04/2025",
      },
      {
        name: "Báo Tuổi trẻ",
        url: "https://tuoitre.vn/plo/luat-su-cua-1-bi-cao-nguoi-nuoc-ngoai-de-nghi-cho-than-chu-huong-tinh-tiet-pham-toi-do-lac-hau-109842526.htm",
        title: "Luật sư của 1 bị cáo người nước ngoài đề nghị cho thân chủ hưởng tình tiết “phạm tội do lạc hậu”",
        publishedAt: "04/04/2025",
      },
    ],
  },
  {
    slug: "dai-an-van-thinh-phat-giai-doan-1",
    title: "Đại án Vạn Thịnh Phát — Giai đoạn 1",
    court: "Tòa án nhân dân Cấp cao tại TP.HCM",
    date: "03/12/2024",
    year: 2024,
    role: "",
    defendant: "",
    charge: "",
    category: "Hình sự",
    summary:
      "Luật sư Đặng Kim Chinh là người bào chữa cho bị cáo Lê Khánh Hiền — nguyên Tổng Giám đốc Ngân hàng TMCP Sài Gòn (SCB) — tại cấp phúc thẩm. Ngày 03/12/2024, Hội đồng xét xử phúc thẩm tuyên phạt bị cáo 3 năm tù, giảm 2 năm so với bản án sơ thẩm.",
    body: `<h2>Bối cảnh tố tụng</h2>
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
        title: "Phúc thẩm đại án Vạn Thịnh Phát: Luật sư trình bày về “trường hợp đặc biệt” của một bị cáo",
        publishedAt: "06/11/2024",
      },
      {
        name: "CafeF",
        url: "https://cafef.vn/phuc-tham-dai-an-van-thinh-phat-luat-su-trinh-bay-ve-truong-hop-dac-biet-cua-mot-bi-cao-188241106211809523.chn",
        title: "Phúc thẩm đại án Vạn Thịnh Phát: Luật sư trình bày về “trường hợp đặc biệt” của một bị cáo",
        publishedAt: "06/11/2024",
      },
    ],
  },
  {
    slug: "buon-lau-xang-dau-200-trieu-lit",
    title: "Vụ buôn lậu gần 200 triệu lít xăng dầu",
    court: "Tòa án nhân dân Cấp cao tại TP.HCM",
    date: "17/04/2023",
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
<p>Năm 2024, Hội đồng Thẩm phán Tòa án nhân dân Tối cao xét xử giám đốc thẩm, nhận định việc hai cấp tòa chỉ áp dụng hình phạt tiền là hình phạt chính đối với 10 bị cáo là chủ doanh nghiệp — trong khi những người giúp sức có vai trò nhẹ hơn lại bị áp dụng hình phạt tù — là sai lầm trong việc áp dụng pháp luật, chưa bảo đảm nguyên tắc phân hóa trách nhiệm hình sự trong đồng phạm. Trên cơ sở đó, Hội đồng giám đốc thẩm hủy một phần bản án phúc thẩm và một phần bản án sơ thẩm để xét xử sơ thẩm lại theo hướng không áp dụng hình phạt chính là phạt tiền.</p>`,
    keyArguments: [],
    sources: [
      {
        name: "Báo Lao Động",
        url: "https://laodong.vn/phap-luat/an-ninh-that-chat-tai-phien-phuc-tham-vu-buon-lau-200-trieu-lit-xang-dau-1157100.ldo",
        title: "An ninh thắt chặt tại phiên phúc thẩm vụ buôn lậu 200 triệu lít xăng dầu",
        publishedAt: "13/03/2023",
      },
    ],
  },
  {
    slug: "dai-an-xang-dau-giai-doan-2-tron-thue",
    title: "Đại án xăng dầu giai đoạn 2 — tội “Trốn thuế”",
    court: "Tòa án nhân dân tỉnh Đồng Nai",
    date: "01/04/2024",
    year: 2024,
    role: "",
    defendant: "",
    charge: "Trốn thuế",
    category: "Hình sự",
    summary:
      "Giai đoạn 2 của đại án xăng dầu, xét xử 32 bị cáo về tội “Trốn thuế” với tổng số tiền trốn thuế hơn 15,2 tỷ đồng. CNN Legal tham gia bảo vệ quyền lợi khách hàng trong vụ án này.",
    body: `<h2>Bối cảnh tố tụng</h2>
<p>Sau giai đoạn 1 về hành vi buôn lậu xăng dầu, cơ quan tố tụng tiếp tục xử lý giai đoạn 2 đối với nhóm doanh nghiệp và cá nhân tiêu thụ nguồn xăng nhập lậu. Ngày 01/4/2024, Tòa án nhân dân tỉnh Đồng Nai tuyên án đối với 32 bị cáo về tội "Trốn thuế", với tổng số tiền trốn thuế được xác định là hơn 15,2 tỷ đồng.</p>

<h2>Kết quả xét xử</h2>
<p>Hội đồng xét xử tuyên phạt bị cáo Nguyễn Đức Dần 24 tháng tù và bị cáo Nguyễn Đức Chuyên 16 tháng tù. Bị cáo Mai Thị Dần bị áp dụng hình phạt tiền 01 tỷ đồng. 29 bị cáo còn lại bị áp dụng hình phạt tiền hoặc hình phạt tù bằng thời hạn tạm giam.</p>`,
    keyArguments: [],
    sources: [
      {
        name: "Thông tấn xã Việt Nam (VietnamPlus)",
        url: "https://www.vietnamplus.vn/dai-an-xang-dau-giai-doan-2-tuyen-an-cac-bi-cao-ve-toi-tron-thue-post937755.amp",
        title: "Đại án xăng dầu giai đoạn 2: Tuyên án các bị cáo về tội “Trốn thuế”",
        publishedAt: "01/04/2024",
      },
    ],
  },
  {
    slug: "ma-tuy-quan-bar-phuong-lam",
    title: "Vụ án ma túy tại quán bar Phương Lâm",
    court: "Tòa án nhân dân TP.HCM",
    date: "20/01/2025",
    year: 2025,
    role: "",
    defendant: "",
    charge:
      "Mua bán, tàng trữ, tổ chức và chứa chấp việc sử dụng trái phép chất ma túy",
    category: "Hình sự",
    summary:
      "Vụ án 23 bị cáo liên quan đến hoạt động ma túy tại một quán bar ở quận Tân Phú, xét xử tại Tòa án nhân dân Thành phố Hồ Chí Minh từ ngày 20/01/2025. CNN Legal tham gia bảo vệ quyền lợi khách hàng trong vụ án này.",
    body: `<h2>Bối cảnh vụ việc</h2>
<p>Rạng sáng ngày 21/01/2024, lực lượng công an kiểm tra hành chính quán bar Phương Lâm tại quận Tân Phú, Thành phố Hồ Chí Minh. Tại thời điểm kiểm tra, quán có hơn 200 người; cơ quan chức năng ghi nhận 25 bàn có chất ma túy và 79 người có kết quả dương tính với chất ma túy.</p>

<h2>Diễn biến tố tụng</h2>
<p>Tòa án nhân dân Thành phố Hồ Chí Minh mở phiên tòa từ ngày 20/01/2025, xét xử 23 bị cáo gồm người quản lý, nhân viên và khách của quán về các tội "Mua bán trái phép chất ma túy", "Tàng trữ trái phép chất ma túy", "Tổ chức sử dụng trái phép chất ma túy" và "Chứa chấp việc sử dụng trái phép chất ma túy".</p>`,
    keyArguments: [],
    sources: [
      {
        name: "Báo VnExpress",
        url: "https://vnexpress.net/23-nguoi-lien-quan-ma-tuy-tai-quan-bar-phuong-lam-hau-toa-4841067.html",
        title: "23 người liên quan ma túy tại quán bar Phương Lâm hầu tòa",
        publishedAt: "20/01/2025",
      },
      {
        name: "Cổng Thông tin điện tử Bộ Công an",
        url: "https://vov.gov.vn/bo-cong-an-thong-tin-ve-chuyen-an-ma-tuy-lon-tai-quan-bar-phuong-lam-tphcm-dtnew-856175",
        title: "Bộ Công an thông tin về chuyên án ma tuý lớn tại quán bar Phương Lâm, TPHCM",
        publishedAt: "",
      },
    ],
  },
  {
    slug: "tranh-chap-bat-dong-san-go-vap",
    title: "Vụ tranh chấp bất động sản tại Gò Vấp",
    court: "Tòa án nhân dân TP.HCM",
    date: "08/01/2026",
    year: 2026,
    role: "",
    defendant: "",
    charge: "",
    category: "Dân sự",
    summary:
      "Tranh chấp yêu cầu tuyên vô hiệu hợp đồng chuyển nhượng quyền sử dụng đất và tài sản gắn liền với đất tại quận Gò Vấp. Tòa phúc thẩm hủy bản án sơ thẩm, trả hồ sơ để xét xử lại. CNN Legal tham gia bảo vệ quyền lợi khách hàng trong vụ việc này.",
    body: `<h2>Nội dung tranh chấp</h2>
<p>Vụ việc liên quan đến yêu cầu tuyên bố vô hiệu hợp đồng chuyển nhượng quyền sử dụng đất, quyền sở hữu nhà ở và tài sản khác gắn liền với đất đối với bất động sản trên đường Quang Trung, quận Gò Vấp (nay thuộc phường An Hội Tây), Thành phố Hồ Chí Minh.</p>

<h2>Kết quả phúc thẩm</h2>
<p>Ngày 08/01/2026, Tòa án nhân dân Thành phố Hồ Chí Minh xét xử phúc thẩm và tuyên hủy bản án sơ thẩm, trả hồ sơ để xét xử lại. Hội đồng xét xử phúc thẩm nhận định cả hai hợp đồng chuyển nhượng đều đã được công chứng, chứng thực theo quy định của pháp luật; đồng thời cấp sơ thẩm chưa xác minh và đưa những người có quyền lợi, nghĩa vụ liên quan vào tham gia tố tụng.</p>`,
    keyArguments: [],
    sources: [
      {
        name: "Báo Công an TP.HCM",
        url: "https://congan.com.vn/song-theo-phap-luat/toa-phuc-tham-tuyen-huy-ban-an-tra-ve-xet-xu-lai_187853.html",
        title: "Tòa phúc thẩm tuyên hủy bản án, trả về xét xử lại",
        publishedAt: "10/01/2026",
      },
      {
        name: "Báo Công an TP.HCM",
        url: "https://congan.com.vn/thong-tin-ban-doc/nguy-co-mat-nha-du-nhan-chuyen-nhuong-ngay-tinh-va-hop-phap_181917.html",
        title: "Nguy cơ mất nhà dù nhận chuyển nhượng ngay tình và hợp pháp",
        publishedAt: "18/08/2025",
      },
      {
        name: "Báo Công an TP.HCM",
        url: "https://congan.com.vn/thong-tin-ban-doc/nguy-co-mat-nha-du-nhan-chuyen-nhuong-ngay-tinh-va-hop-phap_182049.html",
        title: "Nguy cơ mất nhà dù nhận chuyển nhượng ngay tình và hợp pháp (kỳ cuối)",
        publishedAt: "20/08/2025",
      },
      {
        name: "Tạp chí điện tử Luật sư Việt Nam",
        url: "https://lsvn.vn/chuyen-nhuong-quyen-su-dung-dat-de-thuc-hien-nghia-vu-tra-no-ranh-gioi-voi-giao-dich-dan-su-vo-hieu-do-gia-tao-a166081.html",
        title: "Chuyển nhượng quyền sử dụng đất để thực hiện nghĩa vụ trả nợ: Ranh giới với giao dịch dân sự vô hiệu do giả tạo",
        publishedAt: "23/11/2025",
      },
    ],
  },
  {
    slug: "hanh-chinh-cuong-che-van-phong-quan-3",
    title: "Vụ án hành chính - Quyết định cưỡng chế phá dỡ Tòa nhà văn phòng tại Quận 3",
    court: "",
    date: "",
    year: 2019,
    role: "",
    defendant: "",
    charge: "",
    category: "Hành chính",
    summary:
      "Vụ việc hành chính liên quan đến chỉ tiêu kiến trúc và giấy phép xây dựng công trình nhà liên kế tại đường Trương Định, Quận 3, Thành phố Hồ Chí Minh. CNN Legal tham gia bảo vệ quyền lợi khách hàng trong vụ việc này.",
    body: `<h2>Nội dung vụ việc</h2>
<p>Công trình tại số 8 Trương Định, Quận 3 được cấp Giấy phép xây dựng số 10/GPXD ngày 12/01/2017. Chủ đầu tư cho rằng giấy phép có sự bất cập giữa các văn bản pháp luật và văn bản hành chính của Ủy ban nhân dân Thành phố Hồ Chí Minh, liên quan đến cả ba tiêu chí: chiều cao công trình, mật độ xây dựng và hệ số sử dụng đất.</p>

<h2>Vướng mắc về chỉ tiêu kiến trúc</h2>
<p>Theo tiêu chuẩn áp dụng, công trình chỉ được xây 5 tầng với chiều cao khoảng 18m; muốn xây 8 tầng cao 27m thì phải mở lỗ thông tầng (giếng trời) qua các tầng. Trên diện tích sàn 79m², lỗ thông tầng chiếm 15,9m² ở các tầng 2, 3, 4 và lên tới 36,9m² ở các tầng 5 đến 8 — khiến diện tích sử dụng chính mỗi tầng chỉ còn lần lượt khoảng 23,94m² và 12,6m². Giấy phép đồng thời không cho lắp thang máy, không có tum thang và không được lợp mái sân thượng.</p>`,
    keyArguments: [],
    sources: [
      {
        name: "Báo Xây dựng",
        url: "https://baoxaydung.vn/thanh-pho-ho-chi-minh-chuyen-gieng-troi-nhung-bat-cap-trong-chi-tieu-kien-truc-va-cap-phep-xay-dung-1926868266944.htm",
        title: "Thành phố Hồ Chí Minh: Chuyện “giếng trời” những bất cập trong chỉ tiêu kiến trúc và cấp phép xây dựng",
        publishedAt: "13/11/2019",
      },
      {
        name: "Báo Ngày mới",
        url: "https://ngaymoionline.com.vn/tp-ho-chi-minh-xay-gieng-trong-nha-pho-cau-hoi-den-bao-gio-duoc-tra-loi-4269.html",
        title: "TP Hồ Chí Minh: “Xây giếng” trong nhà phố, câu hỏi đến bao giờ được trả lời?",
        publishedAt: "16/11/2019",
      },
      {
        name: "Báo Xây dựng",
        url: "https://baoxaydung.vn/thanh-pho-ho-chi-minh-xay-gieng-trong-nha-pho-cau-hoi-den-bao-gio-moi-duoc-tra-loi-1926868267265.htm",
        title: "Thành phố Hồ Chí Minh: “Xây giếng” trong nhà phố, câu hỏi đến bao giờ mới được trả lời?",
        publishedAt: "18/11/2019",
      },
      {
        name: "Cục Kinh tế xây dựng (Bộ Xây dựng)",
        url: "https://cemia.gov.vn/tin-tuc/thanh-pho-ho-chi-minh-chuyen-%E2%80%9Cgieng-troi%E2%80%9D-nhung-bat-cap-trong-chi-tieu-kien-truc-va-cap-phep-xay-dung.t-9.html",
        title: "Thành phố Hồ Chí Minh: Chuyện “giếng trời” những bất cập trong chỉ tiêu kiến trúc và cấp phép xây dựng",
        publishedAt: "",
      },
    ],
  },
];
