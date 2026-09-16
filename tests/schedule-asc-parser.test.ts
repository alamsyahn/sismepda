import { strict as assert } from "node:assert"
import { test } from "node:test"

import {
  AscParseError,
  daysFromMask,
  parseAscTimetable,
  referencedExternalIds,
} from "../lib/asc-timetable-parser"

/**
 * Berkas aSc minimal namun realistis: dua guru, dua kelas, dua mapel, satu
 * grup, dan card yang sengaja ditulis TIDAK berurutan supaya resolusi
 * card→lesson tidak boleh bergantung pada urutan node.
 */
const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<timetable>
  <periods>
    <period period="2" name="2" starttime="07:40" endtime="08:20"/>
    <period period="1" name="1" starttime="07:00" endtime="07:40"/>
  </periods>
  <subjects>
    <subject id="S1" name="Informatika" short="INF"/>
    <subject id="S2" name="Pendidikan Pancasila" short="PP"/>
  </subjects>
  <teachers>
    <teacher id="T1" name="Muhammad Nur Alamsyah, S.pd." short="MNA"/>
    <teacher id="T2" name="Siti Aminah" short="SA"/>
  </teachers>
  <classes>
    <class id="C1" name="VII A"/>
    <class id="C2" name="VII B"/>
  </classes>
  <groups>
    <group id="G1" classid="C2" name="Seluruh kelas"/>
  </groups>
  <classrooms>
    <classroom id="R1" name="Lab Komputer"/>
  </classrooms>
  <lessons>
    <lesson id="L1" classids="C1" subjectid="S1" teacherids="T1" classroomids="R1"/>
    <lesson id="L2" groupids="G1" subjectid="S2" teacherids="T2"/>
  </lessons>
  <cards>
    <card id="K3" lessonid="L2" period="1" days="0100000"/>
    <card id="K1" lessonid="L1" period="1" days="100000"/>
    <card id="K2" lessonid="L1" period="2" days="101000"/>
  </cards>
</timetable>`

test("bitmask hari aSc diterjemahkan berdasarkan posisi, bukan urutan", () => {
  assert.deepEqual(daysFromMask("100000"), [1])
  assert.deepEqual(daysFromMask("101000"), [1, 3])
  assert.deepEqual(daysFromMask("000001"), [6])
  assert.deepEqual(daysFromMask(null), [])
  assert.deepEqual(daysFromMask(""), [])
})

test("card di-resolve ke lesson-nya walau urutan node acak", () => {
  const timetable = parseAscTimetable(SAMPLE_XML)

  // K2 menyala pada dua hari, jadi satu card menghasilkan dua penempatan.
  assert.equal(timetable.placements.length, 4)

  const senin1 = timetable.placements.find((row) => row.day === 1 && row.period === 1 && row.lessonId === "L1")
  assert.ok(senin1)
  assert.deepEqual(senin1.teacherExternalIds, ["T1"])
  assert.deepEqual(senin1.classExternalIds, ["C1"])
  assert.equal(senin1.subjectExternalId, "S1")
  assert.equal(senin1.classroomName, "Lab Komputer")

  const rabu = timetable.placements.find((row) => row.day === 3)
  assert.ok(rabu)
  assert.equal(rabu.period, 2)
})

test("lesson yang menunjuk grup tetap menemukan kelasnya", () => {
  const timetable = parseAscTimetable(SAMPLE_XML)
  const viaGroup = timetable.placements.find((row) => row.lessonId === "L2")
  assert.ok(viaGroup)
  assert.deepEqual(viaGroup.classExternalIds, ["C2"])
  assert.equal(viaGroup.day, 2)
})

test("period terbaca dan diurutkan, jamnya hanya informasi", () => {
  const timetable = parseAscTimetable(SAMPLE_XML)
  assert.deepEqual(
    timetable.periods.map((row) => row.period),
    [1, 2],
  )
  assert.equal(timetable.periods[0].startTime, "07:00")
})

test("XML rusak ditolak dengan galat yang jelas, bukan crash", () => {
  assert.throws(() => parseAscTimetable(""), AscParseError)
  assert.throws(() => parseAscTimetable("   "), AscParseError)
  assert.throws(() => parseAscTimetable("<timetable><cards>"), AscParseError)
})

test("berkas tanpa penempatan yang dapat dibaca ditolak", () => {
  assert.throws(
    () => parseAscTimetable(`<timetable><lessons><lesson id="L1"/></lessons><cards/></timetable>`),
    AscParseError,
  )
})

test("card yang menunjuk lesson tidak ada menjadi peringatan, bukan kegagalan total", () => {
  const xml = SAMPLE_XML.replace('<card id="K3" lessonid="L2"', '<card id="K3" lessonid="HILANG"')
  const timetable = parseAscTimetable(xml)

  assert.equal(timetable.placements.length, 3)
  const warning = timetable.warnings.find((row) => row.code === "unknown_reference")
  assert.ok(warning, "referensi lesson tak dikenal harus dilaporkan")
})

test("card tanpa period atau tanpa hari dilewati dengan peringatan", () => {
  const xml = `<?xml version="1.0"?>
<timetable>
  <subjects><subject id="S1" name="Informatika"/></subjects>
  <teachers><teacher id="T1" name="A"/></teachers>
  <classes><class id="C1" name="VII A"/></classes>
  <lessons><lesson id="L1" classids="C1" subjectid="S1" teacherids="T1"/></lessons>
  <cards>
    <card id="K1" lessonid="L1" days="100000"/>
    <card id="K2" lessonid="L1" period="1" days="000000"/>
    <card id="K3" lessonid="L1" period="1" days="100000"/>
  </cards>
</timetable>`

  const timetable = parseAscTimetable(xml)
  assert.equal(timetable.placements.length, 1)
  assert.ok(timetable.warnings.some((row) => row.code === "card_without_period"))
  assert.ok(timetable.warnings.some((row) => row.code === "card_without_day"))
})

test("penempatan ganda pada lesson+jam+hari yang sama tidak diduplikasi", () => {
  const xml = SAMPLE_XML.replace(
    '<card id="K2" lessonid="L1" period="2" days="101000"/>',
    '<card id="K2" lessonid="L1" period="2" days="101000"/><card id="K4" lessonid="L1" period="2" days="100000"/>',
  )
  const timetable = parseAscTimetable(xml)

  const seninJam2 = timetable.placements.filter(
    (row) => row.day === 1 && row.period === 2 && row.lessonId === "L1",
  )
  assert.equal(seninJam2.length, 1)
  assert.ok(timetable.warnings.some((row) => row.code === "duplicate_placement"))
})

test("hari di luar Senin–Sabtu tidak dibawa masuk", () => {
  const xml = SAMPLE_XML.replace('days="100000"', 'days="0000000"')
  const timetable = parseAscTimetable(xml)
  assert.ok(timetable.placements.every((row) => row.day >= 1 && row.day <= 6))
})

test("entitas ganda dengan id sama tidak menggandakan daftar", () => {
  const xml = SAMPLE_XML.replace(
    '<teacher id="T2" name="Siti Aminah" short="SA"/>',
    '<teacher id="T2" name="Siti Aminah" short="SA"/><teacher id="T2" name="Siti Aminah (ganda)"/>',
  )
  const timetable = parseAscTimetable(xml)
  assert.equal(timetable.teachers.filter((row) => row.externalId === "T2").length, 1)
  assert.equal(timetable.teachers.find((row) => row.externalId === "T2")?.name, "Siti Aminah")
})

test("hanya entitas yang benar-benar dirujuk penempatan yang perlu dipetakan", () => {
  const timetable = parseAscTimetable(SAMPLE_XML)
  const referenced = referencedExternalIds(timetable)

  assert.deepEqual([...referenced.teachers].sort(), ["T1", "T2"])
  assert.deepEqual([...referenced.classes].sort(), ["C1", "C2"])
  assert.deepEqual([...referenced.subjects].sort(), ["S1", "S2"])
})

test("entitas XML tidak diekspansi (billion laughs tidak meledakkan parser)", () => {
  const xml = `<?xml version="1.0"?>
<!DOCTYPE timetable [
  <!ENTITY lol "lol">
  <!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
  <!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">
]>
<timetable>
  <subjects><subject id="S1" name="&lol3;"/></subjects>
  <teachers><teacher id="T1" name="A"/></teachers>
  <classes><class id="C1" name="VII A"/></classes>
  <lessons><lesson id="L1" classids="C1" subjectid="S1" teacherids="T1"/></lessons>
  <cards><card id="K1" lessonid="L1" period="1" days="100000"/></cards>
</timetable>`

  const timetable = parseAscTimetable(xml)
  const subject = timetable.subjects.find((row) => row.externalId === "S1")
  assert.ok(subject)
  // Nama tetap berisi rujukan entitas mentah; yang penting ia TIDAK diperbesar
  // menjadi ribuan karakter oleh parser.
  assert.ok(subject.name.length < 50)
})
