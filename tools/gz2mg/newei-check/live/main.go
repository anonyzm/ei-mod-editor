// Headless run of the 2026-11-17 «живые карты» additions (tools/gz2mg/live.mjs) in New EI: gz1mg and gz2mg side quests.
package main

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"runtime"
	"strings"

	"newei/engine"
	"newei/gl"
	"newei/win"
)

const dir = `C:\GOG Games\EI_edit\Evil Islands`

var now float64

func tick(z *engine.Zone, n int) {
	for i := 0; i < n; i++ {
		now += engine.TickSeconds
		z.Update(now)
	}
}
func unit(z *engine.Zone, name string) *engine.Unit {
	for _, u := range z.Units {
		if strings.EqualFold(u.In.Obj.Name, name) {
			return u
		}
	}
	fmt.Println("FAIL no unit", name)
	os.Exit(1)
	return nil
}
func put(z *engine.Zone, x, y float32) {
	for _, h := range z.Party() {
		h.Pos[0], h.Pos[1] = x, y
		h.HP = h.MaxHP // the checks teleport a first-level hero next to orcs and boars
	}
}
func at(z *engine.Zone, name string) { u := unit(z, name); put(z, u.Pos[0]+2, u.Pos[1]); tick(z, 40) }
func moves(z *engine.Zone, n int, names ...string) {
	p0 := map[string][3]float32{}
	for _, s := range names {
		p0[s] = unit(z, s).Pos
	}
	far := map[string]float32{}
	for i := 0; i < n; i += 250 {
		tick(z, 250)
		for _, s := range names {
			u := unit(z, s)
			dx, dy := u.Pos[0]-p0[s][0], u.Pos[1]-p0[s][1]
			far[s] = max(far[s], dx*dx+dy*dy)
		}
	}
	for _, s := range names {
		check(far[s] > 1, "%s walks its route (from %.0f,%.0f, farthest %.0f m)", s, p0[s][0], p0[s][1], float32(math.Sqrt(float64(far[s]))))
	}
}
func check(ok bool, what string, a ...any) {
	s := "ok  "
	if !ok {
		s = "FAIL"
	}
	fmt.Printf("%s %s\n", s, fmt.Sprintf(what, a...))
}

func main() {
	runtime.LockOSThread()
	w, err := win.Open("live check", 64, 64, false)
	if err != nil {
		fmt.Println(err)
		os.Exit(1)
	}
	defer w.Close()
	if err := gl.Init(); err != nil {
		fmt.Println(err)
		os.Exit(1)
	}
	var P map[string][2]float32
	b, _ := os.ReadFile(`C:\GOG Games\EI_edit\Editor\tools\gz2mg\live_points.json`)
	json.Unmarshal(b, &P)
	a, err := engine.OpenAssets(dir)
	if err != nil {
		fmt.Println(err)
		os.Exit(1)
	}
	c, err := engine.NewGame(a)
	if err != nil {
		fmt.Println(err)
		os.Exit(1)
	}
	v := func(s string) float64 { return float64(c.Var(s)) }
	says := func(z *engine.Zone, list ...[2]string) {
		for _, s := range list {
			u, ack := z.Say(s[0], s[1], false)
			check(u != nil && ack != nil, "say %s by %s", s[0], s[1])
		}
	}
	// ---------- gz1mg ----------
	z, _, err := c.Enter("gz1mg", 1, 12)
	if err != nil {
		fmt.Println("gz1mg:", err)
		os.Exit(1)
	}
	z.VM.Log = func(f string, a ...any) { fmt.Printf("    [gz1mg vm] "+f+"\n", a...) }
	tick(z, 40)
	{
		h := z.Party()[0]
		lj := unit(z, "Lumberjack1")
		okGo := z.MoveTo(h, lj.Pos[0]+9, lj.Pos[1]+6)
		tick(z, 2600)
		check(okGo && (h.Pos[0]-lj.Pos[0])*(h.Pos[0]-lj.Pos[0])+(h.Pos[1]-lj.Pos[1])*(h.Pos[1]-lj.Pos[1]) < 900, "hero walked to the lumberjacks (%.0f,%.0f)", h.Pos[0], h.Pos[1])
		l2 := unit(z, "Lumberjack2") // the map puts him at 142.2, 15.8; by now he is on his way along the route
		check((l2.Pos[0]-142.2)*(l2.Pos[0]-142.2)+(l2.Pos[1]-15.8)*(l2.Pos[1]-15.8) > 25, "Lumberjack2 walks his route (now at %.0f,%.0f)", l2.Pos[0], l2.Pos[1])
	}
	fmt.Printf("--- gz1mg: script err=%v missing=%v units=%d\n", z.ScriptErr, z.VM.Missing, len(z.Units))
	says(z, [2]string{"gz1mg10", "Fenn"}, [2]string{"gz1mg11", "Fenn"}, [2]string{"gz1mg12", "Radim"}, [2]string{"gz1mg13", "Radim"}, [2]string{"gz1mg14", "Radim"}, [2]string{"gz1mg15", "Pilgrim3"}, [2]string{"gz1mg16", "Pilgrim3"}, [2]string{"gz1mg17", "Peddler"})
	at(z, "Fenn")
	check(v("q.gz1mg.qgz1mg4") == 1 && v("q.gz1mg.qgz1mg4.3") == 1, "salt: quest given by Fenn")
	for _, k := range []string{"v1", "v2", "v3"} {
		put(z, P[k][0]+1.5, P[k][1]+1.5)
		tick(z, 30)
	}
	check(v("q.gz1mg.qgz1mg4.4") == 1 && len(z.QuestItems[0]) == 3, "salt: three vents (sub4=%v, items %v)", v("q.gz1mg.qgz1mg4.4"), z.QuestItems[0])
	at(z, "Fenn")
	check(v("q.gz1mg.qgz1mg4") == 2 && len(z.QuestItems[0]) == 0, "salt: done (q=%v, items %v)", v("q.gz1mg.qgz1mg4"), z.QuestItems[0])
	at(z, "Radim")
	check(v("q.gz1mg.qgz1mg5.1") == 1, "dragon: quest given by Radim")
	z.Kill(unit(z, "Dragon"))
	tick(z, 40)
	at(z, "Radim")
	check(v("q.gz1mg.qgz1mg5") == 2, "dragon: done (q=%v)", v("q.gz1mg.qgz1mg5"))
	at(z, "Pilgrim3")
	check(v("q.gz1mg.qgz1mg6.1") == 1, "stone: quest given by the pilgrim")
	z.Kill(unit(z, "Wailer1"))
	z.Kill(unit(z, "Wailer2"))
	tick(z, 40)
	put(z, 176, 88)
	tick(z, 60)
	check(v("q.gz1mg.qgz1mg6") == 2, "stone: done (q=%v)", v("q.gz1mg.qgz1mg6"))
	fmt.Printf("--- gz1mg end: script err=%v missing=%v\n", z.ScriptErr, z.VM.Missing)
	z.Free()
	// ---------- gz2mg ----------
	z, _, err = c.Enter("gz2mg", 1, 12)
	if err != nil {
		fmt.Println("gz2mg:", err)
		os.Exit(1)
	}
	z.VM.Log = func(f string, a ...any) { fmt.Printf("    [gz2mg vm] "+f+"\n", a...) }
	tick(z, 40)
	fmt.Printf("--- gz2mg: script err=%v missing=%v units=%d\n", z.ScriptErr, z.VM.Missing, len(z.Units))
	says(z, [2]string{"gz2mg10", "Healer"}, [2]string{"gz2mg11", "Ssaya"}, [2]string{"gz2mg12", "Ssaya"}, [2]string{"gz2mg13", "Healer"}, [2]string{"gz2mg14", "Fletcher"}, [2]string{"gz2mg15", "Fletcher"},
		[2]string{"gz2mg16", "Grysh"}, [2]string{"gz2mg17", "Grysh"}, [2]string{"gz2mg18", "Bern"}, [2]string{"gz2mg19", "Bern"}, [2]string{"gz2mg20", "Bern"}, [2]string{"gz2mg21", "Bern"}, [2]string{"gz2mg4", "Prisoner"})
	at(z, "Healer")
	tick(z, 120)
	check(v("q.gz2mg.qgz2mg11.1") == 1, "root: quest given by the healer")
	at(z, "Ssaya")
	check(v("q.gz2mg.qgz2mg11.2") == 1, "root: the herbalist asks for the banshees")
	z.Kill(unit(z, "SwampBanshee1"))
	z.Kill(unit(z, "SwampBanshee2"))
	tick(z, 40)
	at(z, "Ssaya")
	check(v("q.gz2mg.qgz2mg11.4") == 1 && len(z.QuestItems[0]) == 1, "root: got the root (items %v)", z.QuestItems[0])
	at(z, "Healer")
	check(v("q.gz2mg.qgz2mg11") == 2 && len(z.QuestItems[0]) == 0, "root: done (q=%v)", v("q.gz2mg.qgz2mg11"))
	at(z, "Fletcher")
	check(v("q.gz2mg.qgz2mg13.1") == 1, "arrows: quest given by the fletcher")
	at(z, "Grysh")
	check(v("q.gz2mg.qgz2mg12.1") == 1, "drum: quest given by Grysh")
	z.Kill(unit(z, "Drummer"))
	tick(z, 40)
	at(z, "Grysh")
	check(v("q.gz2mg.qgz2mg12") == 2, "drum: done (q=%v)", v("q.gz2mg.qgz2mg12"))
	at(z, "Bern")
	check(v("q.gz2mg.qgz2mg14.1") == 1, "pig: quest given by Bern")
	for _, s := range []string{"BoarDarkF4-36", "BoarDarkF4-37", "BoarDarkF4-38"} {
		z.Kill(unit(z, s))
	}
	pig, bern := unit(z, "Piggy"), unit(z, "Bern")
	put(z, pig.Pos[0]+2, pig.Pos[1])
	tick(z, 40)
	check(v("q.gz2mg.qgz2mg14.2") == 1, "pig: found")
	// the hero walks home on foot (a teleported hero wakes nobody and the pig would fall asleep behind)
	h := z.Party()[0]
	fmt.Printf("    before the walk: hero %.1f,%.1f dead=%v hp=%.0f, pig %.1f,%.1f, target %.1f,%.1f\n", h.Pos[0], h.Pos[1], h.Dead(), h.HP, pig.Pos[0], pig.Pos[1], bern.Pos[0]-2, bern.Pos[1]+3.5)
	okHome := z.MoveTo(h, bern.Pos[0]-2, bern.Pos[1]+3.5)
	for i := 0; i < 10 && !okHome; i++ {
		tick(z, 20)
		okHome = z.MoveTo(h, 57, 108)
	}
	for i := 0; i < 500 && v("q.gz2mg.qgz2mg14") != 2; i++ {
		tick(z, 20)
	}
	fmt.Printf("    hero walks home: order %v, hero at %.0f,%.0f\n", okHome, h.Pos[0], h.Pos[1])
	check(v("q.gz2mg.qgz2mg14") == 2 && !pig.Dead(), "pig: followed the hero home (q=%v, pig at %.0f,%.0f dead=%v, bern %.0f,%.0f)", v("q.gz2mg.qgz2mg14"), pig.Pos[0], pig.Pos[1], pig.Dead(), bern.Pos[0], bern.Pos[1])
	fmt.Printf("--- gz2mg end: script err=%v missing=%v\n", z.ScriptErr, z.VM.Missing)
	z.Free()
}
