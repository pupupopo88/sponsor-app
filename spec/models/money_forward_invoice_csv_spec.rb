# frozen_string_literal: true

require 'rails_helper'

RSpec.describe MoneyForwardInvoiceCsv do
  subject(:invoice_csv) do
    described_class.new(
      conference:,
      sponsorships:,
      invoice_date: Date.new(2026, 8, 16),
      delivery_date: Date.new(2026, 10, 3),
    )
  end

  let(:sponsorships) { [sponsorship] }
  let(:conference) { instance_double(Conference, name: 'RubyKaigi YYYY') }
  let(:contact) do
    instance_double(
      Contact,
      organization: '株式会社Ruby',
      address: '東京都千代田区1-1',
      unit: '技術部',
      name: '山田太郎',
    )
  end
  let(:plan) { instance_double(Plan, name: 'Ruby', price: 300_000, price_booth: 50_000) }
  let(:sponsorship) do
    instance_double(Sponsorship, billing_contact: contact, plan:, booth_assigned: true, customization: false, expense_report: nil)
  end

  describe '#rows' do
    it 'builds invoice, plan item, and booth item data with the same number of columns' do
      rows = invoice_csv.rows

      expect(rows.size).to eq(3)
      expect(rows.map(&:size).uniq).to eq([38])
      expect(invoice_csv.headers).to eq([
        'csv_type(変更不可)',
        '行形式',
        '取引先名称',
        '件名',
        '請求日',
        'お支払期限',
        '請求書番号',
        '売上計上日',
        'メモ',
        'タグ',
        '小計',
        '消費税',
        '合計金額',
        '取引先敬称',
        '取引先郵便番号',
        '取引先都道府県',
        '取引先住所1',
        '取引先住所2',
        '取引先部署',
        '取引先担当者役職',
        '取引先担当者氏名',
        '自社担当者氏名',
        '備考',
        '振込先',
        '入金ステータス',
        'メール送信ステータス',
        '郵送ステータス',
        'ダウンロードステータス',
        '納品日',
        '品名',
        '品目コード',
        '単価',
        '数量',
        '単位',
        '納品書番号',
        '詳細',
        '金額',
        '品目消費税率',
      ])
    end

    it 'builds the invoice values' do
      invoice = invoice_csv.rows.fetch(0)

      expect(invoice.values_at(0, 1, 2, 3)).to eq([40_101, '請求書', '株式会社Ruby', 'RubyKaigi YYYY 協賛のご請求'])
      expect(invoice.values_at(4, 5, 6, 7)).to eq(['2026/08/16', '2026/09/30', '20260816-001', '2026/08/16'])
      expect(invoice.values_at(8, 10, 11, 12)).to eq(['Ruby', 350_000, 35_000, 385_000])
      expect(invoice.values_at(13, 15, 16, 18, 19, 20, 22)).to eq(['御中', nil, nil, '技術部', '', '山田太郎', described_class::NOTE])
    end

    it 'builds the plan and booth item values' do
      plan_item, booth_item = invoice_csv.rows.values_at(1, 2)

      expect(plan_item.values_at(0, 1, 28, 29, 31, 32, 36, 37)).to eq([40_101, '品目', '2026/10/03', 'RubyKaigi YYYY 協賛費用 (Ruby)', 300_000, 1, 300_000, '10%'])
      expect(booth_item.values_at(0, 1, 28, 29, 31, 32, 36, 37)).to eq([40_101, '品目', '2026/10/03', 'RubyKaigi YYYY 協賛費用 (ブース出展)', 50_000, 1, 50_000, '10%'])
    end

    context 'without a booth' do
      let(:sponsorship) do
        instance_double(Sponsorship, billing_contact: contact, plan:, booth_assigned: false, customization: false, expense_report: nil)
      end

      it 'does not add booth price or a booth item' do
        rows = invoice_csv.rows

        expect(rows.size).to eq(2)
        expect(rows.fetch(0).values_at(10, 11, 12)).to eq([300_000, 30_000, 330_000])
      end
    end

    context 'with fractional decimal amounts' do
      let(:plan) { instance_double(Plan, name: 'Ruby', price: 300_000.49.to_d, price_booth: 50_000.50.to_d) }

      it 'rounds monetary output to integer yen before calculating invoice tax' do
        invoice, plan_item, booth_item = invoice_csv.rows.values_at(0, 1, 2)

        expect(invoice.values_at(10, 11, 12)).to eq([350_001, 35_000, 385_001])
        expect(plan_item.values_at(31, 36)).to eq([300_000, 300_000])
        expect(booth_item.values_at(31, 36)).to eq([50_001, 50_001])
      end
    end

    context 'with an approved expense report for a custom sponsorship' do
      let(:expense_report) { instance_double(ExpenseReport, status: 'approved', total_amount: 100_000) }
      let(:sponsorship) do
        instance_double(Sponsorship, billing_contact: contact, plan:, booth_assigned: true, customization: true, expense_report:)
      end

      it 'adds the approved expense as the final negative item' do
        invoice, plan_item, booth_item, custom_item = invoice_csv.rows.values_at(0, 1, 2, 3)

        expect(invoice.values_at(10, 11, 12)).to eq([250_000, 25_000, 275_000])
        expect(plan_item.values_at(29, 31, 36)).to eq(['RubyKaigi YYYY 協賛費用 (Ruby)', 300_000, 300_000])
        expect(booth_item.values_at(29, 31, 36)).to eq(['RubyKaigi YYYY 協賛費用 (ブース出展)', 50_000, 50_000])
        expect(custom_item.values_at(29, 31, 32, 36, 37)).to eq(['カスタムスポンサー費用分', -100_000, 1, -100_000, '10%'])
      end
    end

    context 'with a negative expense amount' do
      let(:expense_report) { instance_double(ExpenseReport, status: 'approved', total_amount: -100) }
      let(:sponsorship) do
        instance_double(Sponsorship, billing_contact: contact, plan:, booth_assigned: true, customization: true, expense_report:)
      end

      it 'adds no deduction item while preserving the calculated subtotal' do
        expect(invoice_csv.rows.size).to eq(3)
        expect(invoice_csv.rows.first.values_at(10, 11, 12)).to eq([350_100, 35_010, 385_110])
      end
    end

    context 'when approved expenses exceed the sponsorship fee' do
      let(:expense_report) { instance_double(ExpenseReport, status: 'approved', total_amount: 400_000) }
      let(:sponsorship) do
        instance_double(Sponsorship, billing_contact: contact, plan:, booth_assigned: false, customization: true, expense_report:)
      end

      it 'separates the negative invoice from exported rows without capping the deduction' do
        invoice, custom_item = invoice_csv.excluded_rows.values_at(0, 2)

        expect(invoice_csv.rows).to eq([])
        expect(invoice.fetch(6)).to be_nil
        expect(invoice.values_at(10, 11, 12)).to eq([-100_000, -10_000, -110_000])
        expect(custom_item.values_at(31, 36)).to eq([-400_000, -400_000])
      end
    end

    context 'when approved expenses equal the sponsorship fee' do
      let(:expense_report) { instance_double(ExpenseReport, status: 'approved', total_amount: 300_000) }
      let(:sponsorship) do
        instance_double(Sponsorship, billing_contact: contact, plan:, booth_assigned: false, customization: true, expense_report:)
      end

      it 'keeps the zero-value invoice in exported rows' do
        expect(invoice_csv.rows.fetch(0).values_at(10, 11, 12)).to eq([0, 0, 0])
        expect(invoice_csv.excluded_rows).to eq([])
      end
    end
  end

  describe '#to_csv' do
    it 'outputs the headers exactly once followed by data rows' do
      expect(CSV.parse(invoice_csv.to_csv).first).to eq(invoice_csv.headers)
      expect(CSV.parse(invoice_csv.to_csv).size).to eq(4)
      expect(CSV.parse(invoice_csv.to_csv).fetch(1).values_at(0, 1, 19)).to eq(['40101', '請求書', ''])
      expect(CSV.parse(invoice_csv.to_csv).fetch(1).fetch(14)).to be_nil
    end

    it 'uses CRLF line endings required by the import format' do
      expect(invoice_csv.to_csv).to end_with("\r\n")
      expect(invoice_csv.to_csv.gsub("\r\n", "")).not_to include("\n", "\r")
    end

    context 'with a negative invoice' do
      let(:expense_report) { instance_double(ExpenseReport, status: 'approved', total_amount: 400_000) }
      let(:sponsorship) do
        instance_double(Sponsorship, billing_contact: contact, plan:, booth_assigned: false, customization: true, expense_report:)
      end

      it 'excludes the invoice from the CSV' do
        expect(CSV.parse(invoice_csv.to_csv)).to eq([described_class::COLUMNS.values])
      end
    end
  end

  context 'with no sponsorships' do
    let(:sponsorships) { [] }

    it 'exports only the header' do
      expect(invoice_csv.rows).to eq([])
      expect(invoice_csv.excluded_rows).to eq([])
      expect(invoice_csv).not_to be_exportable
      expect(CSV.parse(invoice_csv.to_csv)).to eq([described_class::COLUMNS.values])
    end
  end

  context 'with an excluded invoice between exportable invoices' do
    let(:expense_report) { instance_double(ExpenseReport, status: 'approved', total_amount: 400_000) }
    let(:excluded_sponsorship) do
      instance_double(Sponsorship, billing_contact: contact, plan:, booth_assigned: false, customization: true, expense_report:)
    end
    let(:sponsorships) { [sponsorship, excluded_sponsorship, sponsorship] }

    it 'numbers only exported invoices and leaves excluded numbers blank' do
      expect(invoice_csv.rows.values_at(0, 3).map { |row| row.fetch(6) }).to eq(['20260816-001', '20260816-002'])
      expect(invoice_csv.excluded_rows.fetch(0).fetch(6)).to be_nil
    end
  end

  context 'with a specified starting invoice number' do
    subject(:invoice_csv) do
      described_class.new(
        conference:,
        sponsorships:,
        invoice_date: Date.new(2026, 8, 16),
        delivery_date: Date.new(2026, 10, 3),
        starting_invoice_number: 42,
      )
    end

    it 'uses the specified number with zero padding' do
      expect(invoice_csv.rows.fetch(0).fetch(6)).to eq('20260816-042')
    end
  end
end
