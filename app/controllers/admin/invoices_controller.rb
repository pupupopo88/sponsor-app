# frozen_string_literal: true

module Admin
  class InvoicesController < Admin::ApplicationController
    before_action :set_conference

    # https://biz.moneyforward.com/support/invoice/faq/invoice/invoice002.html
    def index
      @invoice_date = params[:invoice_date].present? ? Date.parse(params[:invoice_date]) : Time.zone.today
      @invoice_filter = InvoiceExports::SponsorshipFilter.new(conference: @conference, params: invoice_filter_params)
      invoice_csv = InvoiceExports::MoneyForwardCsv.new(conference: @conference, sponsorships: @invoice_filter.sponsorships, invoice_date: @invoice_date)

      respond_to do |format|
        format.html { @invoice_rows = invoice_csv.rows }
        format.csv do
          send_data(invoice_csv.to_csv, filename: "#{@conference.name.underscore.gsub(" ", "_")}_invoices.csv")
        end
      end
    end

    private def set_conference
      @conference = Conference.find_by!(slug: params[:conference_slug])
      check_staff_conference_authorization!(@conference)
    end

    private def invoice_filter_params
      params.permit(:filters, :customization_filter, locales: [], plan_ids: [])
    end
  end
end
