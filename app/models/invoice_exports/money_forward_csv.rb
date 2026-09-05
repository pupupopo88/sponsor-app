# frozen_string_literal: true

require 'csv'

module InvoiceExports
  class MoneyForwardCsv
    CSV_TYPE = 40_101
    TAX_RATE = BigDecimal('0.1')
    NOTE = '払込手数料は、御社のご負担とさせていただきます。'

    COLUMNS = {
      csv_type: 'csv_type(変更不可)',
      row_type: '行形式',
      customer_name: '取引先名称',
      subject: '件名',
      billing_date: '請求日',
      due_date: 'お支払期限',
      invoice_number: '請求書番号',
      sales_date: '売上計上日',
      memo: 'メモ',
      tag: 'タグ',
      subtotal: '小計',
      tax: '消費税',
      total: '合計金額',
      customer_title: '取引先敬称',
      customer_postal_code: '取引先郵便番号',
      customer_prefecture: '取引先都道府県',
      customer_address1: '取引先住所1',
      customer_address2: '取引先住所2',
      customer_department: '取引先部署',
      customer_contact_title: '取引先担当者役職',
      customer_contact_name: '取引先担当者氏名',
      issuer_contact_name: '自社担当者氏名',
      note: '備考',
      bank_account: '振込先',
      payment_status: '入金ステータス',
      email_status: 'メール送信ステータス',
      postal_status: '郵送ステータス',
      download_status: 'ダウンロードステータス',
      delivery_date: '納品日',
      item_name: '品名',
      item_code: '品目コード',
      unit_price: '単価',
      quantity: '数量',
      unit: '単位',
      delivery_number: '納品書番号',
      detail: '詳細',
      amount: '金額',
      item_tax_rate: '品目消費税率',
    }.freeze

    def initialize(conference:, sponsorships:, invoice_date:)
      @conference = conference
      @sponsorships = sponsorships
      @invoice_date = invoice_date
    end

    def rows
      @rows ||= [COLUMNS.values] + sponsorships.each_with_index.flat_map do |sponsorship, index|
        sponsorship_rows(sponsorship, index + 1)
      end
    end

    def to_csv
      CSV.generate(row_sep: "\r\n") do |csv|
        rows.each { |row| csv << row }
      end
    end

    private attr_reader :conference, :sponsorships, :invoice_date

    private def sponsorship_rows(sponsorship, invoice_number)
      rows = [invoice_row(sponsorship, invoice_number), plan_item_row(sponsorship)]
      rows << booth_item_row(sponsorship) if sponsorship.booth_assigned
      rows
    end

    private def invoice_row(sponsorship, invoice_number)
      contact = sponsorship.billing_contact
      subtotal = plan_amount(sponsorship) + booth_amount(sponsorship)
      tax = (subtotal * TAX_RATE).floor

      build_row(
        csv_type: CSV_TYPE,
        row_type: '請求書',
        customer_name: contact.organization,
        subject: "#{conference.name} 協賛のご請求",
        billing_date: formatted_invoice_date,
        due_date: (invoice_date + 1.month).end_of_month.strftime('%Y/%m/%d'),
        invoice_number: "#{invoice_date.strftime("%Y%m%d")}-#{format("%03d", invoice_number)}",
        sales_date: formatted_invoice_date,
        memo: sponsorship.plan.name,
        subtotal:,
        tax:,
        total: subtotal + tax,
        customer_title: '御中',
        customer_department: contact.unit,
        customer_contact_title: '',
        customer_contact_name: contact.name,
        note: NOTE,
      )
    end

    private def plan_item_row(sponsorship)
      item_row("#{conference.name} 協賛費用 (#{sponsorship.plan.name})", plan_amount(sponsorship))
    end

    private def booth_item_row(sponsorship)
      item_row("#{conference.name} 協賛費用 (ブース出展)", booth_amount(sponsorship))
    end

    private def plan_amount(sponsorship)
      amount_in_yen(sponsorship.plan.price)
    end

    private def booth_amount(sponsorship)
      return 0 unless sponsorship.booth_assigned

      amount_in_yen(sponsorship.plan.price_booth)
    end

    private def amount_in_yen(amount)
      amount.to_d.round(0, BigDecimal::ROUND_HALF_UP).to_i
    end

    private def item_row(name, price)
      build_row(
        csv_type: CSV_TYPE,
        row_type: '品目',
        item_name: name,
        unit_price: price,
        quantity: 1,
        amount: price,
        item_tax_rate: tax_rate_label,
      )
    end

    private def tax_rate_label
      "#{(TAX_RATE * 100).to_i}%"
    end

    private def build_row(values)
      COLUMNS.keys.map { |column| values[column] }
    end

    private def formatted_invoice_date
      invoice_date.strftime('%Y/%m/%d')
    end
  end
end
