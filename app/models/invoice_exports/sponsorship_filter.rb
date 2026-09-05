# frozen_string_literal: true

module InvoiceExports
  class SponsorshipFilter
    CUSTOMIZATION_OPTIONS = [
      ['All', 'all'],
      ['Customized only', 'with'],
      ['Non-customized only', 'without'],
    ].freeze

    attr_reader :locales, :plans, :selected_locales, :selected_plan_ids, :customization_filter

    def initialize(conference:, params:)
      @params = params
      @base_scope = conference.sponsorships.active
      @locales = base_scope.reorder(nil).distinct.order(:locale).pluck(:locale)
      @plans = conference.plans.order(:rank, :id).to_a
      @selected_locales = selected_values(:locales, locales)
      @selected_plan_ids = selected_values(:plan_ids, plan_ids)
      @customization_filter = selected_customization_filter
    end

    def sponsorships
      @sponsorships ||= filter_by_customization(
        base_scope.where(locale: selected_locales, plan_id: selected_plan_ids),
      ).includes_contacts.includes(:plan, :expense_report).order(:plan_id, :id)
    end

    def customization_options
      CUSTOMIZATION_OPTIONS
    end

    def locale_selected?(locale)
      selected_locales.include?(locale)
    end

    def plan_selected?(plan)
      selected_plan_ids.include?(plan.id.to_s)
    end

    def customization_selected?(value)
      customization_filter == value
    end

    private attr_reader :params, :base_scope

    private def selected_values(key, default_values)
      return default_values if params[:filters].blank?

      Array(params[key]) & default_values
    end

    private def plan_ids
      plans.map { |plan| plan.id.to_s }
    end

    private def selected_customization_filter
      value = params[:customization_filter]
      customization_values.include?(value) ? value : 'all'
    end

    private def customization_values
      CUSTOMIZATION_OPTIONS.map(&:last)
    end

    private def filter_by_customization(scope)
      case customization_filter
      when 'with' then scope.where(customization: true)
      when 'without' then scope.where(customization: false)
      else scope
      end
    end
  end
end
