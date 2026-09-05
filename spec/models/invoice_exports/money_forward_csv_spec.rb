# frozen_string_literal: true

require 'rails_helper'

RSpec.describe InvoiceExports::MoneyForwardCsv do
  subject(:invoice_csv) do
    described_class.new(
      conference:,
      sponsorships: [sponsorship],
      invoice_date: Date.new(2026, 8, 16),
    )
  end

  let(:conference) { instance_double(Conference, name: 'Kaigi on Rails 2026') }
  let(:contact) do
    instance_double(
      Contact,
      organization: '株式会社Ruby',
      unit: '技術部',
      name: '山田太郎',
    )
  end
  let(:plan) { instance_double(Plan, name: 'Rubyプラン', price: 300_000, price_booth: 50_000) }
  let(:sponsorship) do
    instance_double(
      Sponsorship,
      billing_contact: contact,
      plan:,
      booth_assigned: true,
      customization: false,
      expense_report: nil,
    )
  end

  describe '#rows' do
    it 'builds the header, invoice, plan item, and booth item with the same number of columns' do
      rows = invoice_csv.rows

      expect(rows.size).to eq(4)
      expect(rows.map(&:size).uniq).to eq([38])
      expect(rows.first).to eq(described_class::COLUMNS.values)
    end

    it 'builds the invoice values' do
      invoice = invoice_csv.rows.fetch(1)

      expect(invoice.values_at(0, 1, 2, 3)).to eq([40_101, '請求書', '株式会社Ruby', 'Kaigi on Rails 2026 協賛のご請求'])
      expect(invoice.values_at(4, 5, 6, 7)).to eq(['2026/08/16', '2026/09/30', '20260816-001', '2026/08/16'])
      expect(invoice.values_at(8, 10, 11, 12)).to eq(['Rubyプラン', 350_000, 35_000, 385_000])
      expect(invoice.values_at(13, 15, 16, 18, 19, 20, 22)).to eq(['御中', nil, nil, '技術部', '', '山田太郎', described_class::NOTE])
    end

    it 'builds the plan and booth item values' do
      plan_item, booth_item = invoice_csv.rows.values_at(2, 3)

      expect(plan_item.values_at(0, 1, 29, 31, 32, 36, 37)).to eq([40_101, '品目', 'Kaigi on Rails 2026 協賛費用 (Rubyプラン)', 300_000, 1, 300_000, '10%'])
      expect(booth_item.values_at(0, 1, 29, 31, 32, 36, 37)).to eq([40_101, '品目', 'Kaigi on Rails 2026 協賛費用 (ブース出展)', 50_000, 1, 50_000, '10%'])
    end

    context 'without a booth' do
      let(:sponsorship) do
        instance_double(
          Sponsorship,
          billing_contact: contact,
          plan:,
          booth_assigned: false,
          customization: false,
          expense_report: nil,
        )
      end

      it 'does not add booth price or a booth item' do
        rows = invoice_csv.rows

        expect(rows.size).to eq(3)
        expect(rows.fetch(1).values_at(10, 11, 12)).to eq([300_000, 30_000, 330_000])
      end
    end

    context 'with fractional decimal amounts' do
      let(:plan) { instance_double(Plan, name: 'Rubyプラン', price: 300_000.49.to_d, price_booth: 50_000.50.to_d) }

      it 'rounds monetary output to integer yen before calculating invoice tax' do
        invoice, plan_item, booth_item = invoice_csv.rows.values_at(1, 2, 3)

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
        invoice, plan_item, booth_item, custom_item = invoice_csv.rows.values_at(1, 2, 3, 4)

        expect(invoice.values_at(10, 11, 12)).to eq([250_000, 25_000, 275_000])
        expect(plan_item.values_at(29, 31, 36)).to eq(['Kaigi on Rails 2026 協賛費用 (Rubyプラン)', 300_000, 300_000])
        expect(booth_item.values_at(29, 31, 36)).to eq(['Kaigi on Rails 2026 協賛費用 (ブース出展)', 50_000, 50_000])
        expect(custom_item.values_at(29, 31, 32, 36, 37)).to eq(['カスタムスポンサー費用分', -100_000, 1, -100_000, '10%'])
      end
    end

    context 'with an unapproved expense report for a custom sponsorship' do
      let(:expense_report) { instance_double(ExpenseReport, status: 'submitted', total_amount: 100_000) }
      let(:sponsorship) do
        instance_double(Sponsorship, billing_contact: contact, plan:, booth_assigned: false, customization: true, expense_report:)
      end

      it 'does not deduct the expense' do
        rows = invoice_csv.rows

        expect(rows.size).to eq(3)
        expect(rows.fetch(1).values_at(10, 11, 12)).to eq([300_000, 30_000, 330_000])
      end
    end

    context 'when approved expenses exceed the sponsorship fee' do
      let(:expense_report) { instance_double(ExpenseReport, status: 'approved', total_amount: 400_000) }
      let(:sponsorship) do
        instance_double(Sponsorship, billing_contact: contact, plan:, booth_assigned: false, customization: true, expense_report:)
      end

      it 'separates the negative invoice from exported rows without capping the deduction' do
        invoice, custom_item = invoice_csv.excluded_rows.values_at(1, 3)

        expect(invoice_csv.rows.size).to eq(1)
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
        expect(invoice_csv.rows.fetch(1).values_at(10, 11, 12)).to eq([0, 0, 0])
        expect(invoice_csv.excluded_rows.size).to eq(1)
      end
    end

    context 'when separately rounded fees are lower than the decimal fee total' do
      let(:plan) { instance_double(Plan, name: 'Rubyプラン', price: 100_000.49.to_d, price_booth: 50_000.49.to_d) }
      let(:expense_report) { instance_double(ExpenseReport, status: 'approved', total_amount: 200_000) }
      let(:sponsorship) do
        instance_double(Sponsorship, billing_contact: contact, plan:, booth_assigned: true, customization: true, expense_report:)
      end

      it 'uses the full rounded expense amount in the separated invoice' do
        invoice, custom_item = invoice_csv.excluded_rows.values_at(1, 4)

        expect(invoice.values_at(10, 11, 12)).to eq([-50_000, -5_000, -55_000])
        expect(custom_item.values_at(31, 36)).to eq([-200_000, -200_000])
      end
    end
  end

  describe '#to_csv' do
    it 'uses CRLF line endings required by the import format' do
      expect(invoice_csv.to_csv).to include("\r\n")
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

  context 'with a specified starting invoice number' do
    subject(:invoice_csv) do
      described_class.new(
        conference:,
        sponsorships: [sponsorship],
        invoice_date: Date.new(2026, 8, 16),
        starting_invoice_number: 42,
      )
    end

    it 'uses the specified number with zero padding' do
      expect(invoice_csv.rows.fetch(1).fetch(6)).to eq('20260816-042')
    end
  end
end
