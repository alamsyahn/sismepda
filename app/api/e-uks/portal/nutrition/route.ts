import { requirePermission } from "@/lib/rbac-access"
import { readSchoolNutritionSnapshot } from "@/lib/server-euks"
import { filterByGrade, gradesOf, NUTRITION_CATEGORY_ORDER } from "@/lib/euks-nutrition"
import { portalResponse } from "@/lib/server-euks-portal"

export function GET(request: Request) {
  return portalResponse(request, async () => {
    await requirePermission("euks.measurements.read")
    const buckets = await readSchoolNutritionSnapshot()
    const summarize = (subset: typeof buckets) => NUTRITION_CATEGORY_ORDER.map(category =>
      subset.reduce((sum, bucket) => sum + bucket.counts[category], 0)
    )
    return {
      all: summarize(buckets),
      grades: gradesOf(buckets).map(grade => ({ grade, counts: summarize(filterByGrade(buckets, grade)) })),
    }
  })
}
