# 数据定义与证据位置

- `sources.id` 为内容 SHA-256 前 24 位，完整 SHA 在 `sources.sha256`；`locations` 保留全部原路径与归档成员位置。
- `cases.source_id` 连接 ZMX 原件；`surfaces.case_id` 是逐面记录，面数和透射材料段数均不是独立镜片数。
- `cases.unit`、`field_type`、`aperture_type`、`glass_catalogs`、`flags` 保留原声明和待解释范围。
- `catalog_cases` 一行是 dataset、source_code、patent_number、example_number、zoom_number 组合下的配置。原始逐面/折射率/特殊面型通过该完整键关联 `catalog_records`；不能只凭专利编号关联全体面数据。
- LensVIEW 的 EFL、NA、MAXFLD、类型码、归一化尺度均按原字段解释。NA 字段不能统一改称数值孔径或 F/#；未知单位不补 mm。
- `knowledge_sources` 保存知识卡对应 locator 和 read_scope。`pages.method` 区分 PDF 文本与 OCR；`pages.page` 对 PPT/DOC 是提取段编号。
- `external_resources` 保存导航、历史 URL、核对日期和限制；`resource_evidence` 分开 local_source 与 official_webpage，不能把远程链接算作已下载案例。

通过 CLI `detail patents <id>` 可读取同完整键的原表数据；`detail resources <id>` 可回读本地页证据与官网核对范围。
