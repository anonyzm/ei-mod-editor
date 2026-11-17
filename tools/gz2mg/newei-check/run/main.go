// Headless run of gz2mg / gz3mg / bz1mg in New EI: scripts, quest steps, ferry, battle.
package main

import (
	"fmt"
	"math"
	"os"
	"runtime"
	"sort"
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
	return nil
}
func put(z *engine.Zone, x, y float32) {
	for _, h := range z.Party() {
		h.Pos[0], h.Pos[1] = x, y
	}
}
func check(ok bool, what string, a ...any) {
	s := "ok  "
	if !ok {
		s = "FAIL"
	}
	fmt.Printf("%s %s\n", s, fmt.Sprintf(what, a...))
}
func report(z *engine.Zone, tag string) {
	fmt.Printf("--- %s: script err=%v instances=%d missing=%v\n", tag, z.ScriptErr, len(z.VM.Instances), z.VM.Missing)
}

func main() {
	runtime.LockOSThread()
	w, err := win.Open("gz2mg check", 64, 64, false)
	if err != nil {
		fmt.Println(err)
		os.Exit(1)
	}
	defer w.Close()
	if err := gl.Init(); err != nil {
		fmt.Println(err)
		os.Exit(1)
	}
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
	// ---------- base: the new NPCs and their briefings ----------
	b, _, err := c.Enter("bz1mg", 1, 12)
	if err != nil {
		fmt.Println("bz1mg:", err)
		os.Exit(1)
	}
	b.VM.Log = func(f string, a ...any) { fmt.Printf("    [bz1mg vm] "+f+"\n", a...) }
	tick(b, 40)
	report(b, "bz1mg")
	for _, n := range []string{"Bram", "Rovena", "Goran", "GateGuard", "Headman", "Woodcutter"} {
		u := unit(b, n)
		check(u != nil && u.In.Obj.ID == engine.NameID(n), "base NPC %s with hashed id", n)
	}
	for _, v := range []string{"b.bram.c1", "b.rovena.h1", "b.woodcutter.tw1", "b.goran.s1", "b.headman.hf1", "b.gateguard.gg1"} {
		check(c.Var(v) == 1, "%s = %v", v, c.Var(v))
	}
	b.Free()
	// ---------- gz2mg ----------
	c.Vars["0|q.gz2mg.qgz2mg1"], c.Vars["0|q.gz2mg.qgz2mg1.1"] = 1, 1
	z, arr, err := c.Enter("gz2mg", 1, 12)
	if err != nil {
		fmt.Println("gz2mg:", err)
		os.Exit(1)
	}
	fmt.Printf("arrival %.1f %.1f, party %d, units %d\n", arr.X, arr.Y, len(z.Party()), len(z.Units))
	z.VM.Log = func(f string, a ...any) { fmt.Printf("    [gz2mg vm] "+f+"\n", a...) }
	for _, n := range []string{"Range1", "Range2", "GateArcher", "OArcher1"} {
		if u := unit(z, n); u != nil {
			fmt.Printf("    start %s hp=%.0f/%.0f\n", n, u.HP, u.MaxHP)
		}
	}
	tick(z, 60)
	report(z, "gz2mg start")
	ol := unit(z, "Olgerd")
	check(ol != nil, "Olgerd present")
	put(z, ol.Pos[0]+2, ol.Pos[1])
	tick(z, 30)
	check(c.Var("q.gz2mg.qgz2mg1.2") == 1 && c.Var("b.bram.c2") == 1, "Q1: letter from Olgerd (q1.2=%v, c2=%v, quest items %v)", c.Var("q.gz2mg.qgz2mg1.2"), c.Var("b.bram.c2"), z.QuestItems[0])
	for _, s := range [][2]string{{"gz2mg1", "Olgerd"}, {"gz2mg5", "Olgerd"}, {"gz2mg2", "LizardElder"}, {"gz2mg3", "LizardElder"}, {"gz2mg4", "Prisoner"}} {
		u, ack := z.Say(s[0], s[1], false)
		check(u != nil && ack != nil, "say %s by %s finds the speaker and the phrase", s[0], s[1])
	}
	nev := 0
	for _, e := range z.VM.Events {
		if strings.HasPrefix(e.Str, "say ") {
			nev++
		}
	}
	check(nev > 0, "script sent %d say events", nev)
	// Q2 elder
	c.Vars["0|q.gz2mg.qgz2mg2"], c.Vars["0|q.gz2mg.qgz2mg2.1"] = 1, 1
	el := unit(z, "LizardElder")
	put(z, el.Pos[0]+2, el.Pos[1])
	tick(z, 30)
	check(c.Var("q.gz2mg.qgz2mg2.2") == 1, "Q2: elder talked (q2.2=%v)", c.Var("q.gz2mg.qgz2mg2.2"))
	// ferry: off until the cemetery arch is reached
	put(z, 159.1, 64.8)
	tick(z, 20)
	h := z.Party()[0]
	check(h.Pos[0] < 165, "ferry closed before the crossing (hero at %.1f %.1f)", h.Pos[0], h.Pos[1])
	put(z, 291, 121)
	tick(z, 20)
	check(c.Var("gz2mg.ferry") == 1, "ferry opened at the cemetery arch")
	put(z, 176.1, 67.3)
	tick(z, 20)
	check(h.Pos[0] < 165, "ferry east→west (hero at %.1f %.1f)", h.Pos[0], h.Pos[1])
	put(z, 159.1, 64.8)
	tick(z, 20)
	check(h.Pos[0] > 170, "ferry west→east (hero at %.1f %.1f)", h.Pos[0], h.Pos[1])
	// the battle: who is alive after a minute and a half of game time with the party far away
	put(z, 20, 54)
	alive := func() map[int]int {
		m := map[int]int{}
		for _, u := range z.Units {
			if !u.Dead() {
				m[int(u.In.Obj.Player)]++
			}
		}
		return m
	}
	before := alive()
	tick(z, 5400)
	after := alive()
	fmt.Printf("alive by side before %v after 5 min %v\n", before, after)
	// camp animations / volleys: who is busy
	for _, n := range []string{"Range1", "Spar1", "Drummer", "Wounded1", "March1", "OArcher1", "HArcher1", "FireEl1"} {
		u := unit(z, n)
		if u == nil {
			check(false, "unit %s", n)
			continue
		}
		fmt.Printf("    %-9s dead=%v pos=%.1f,%.1f hp=%.0f\n", n, u.Dead(), u.Pos[0], u.Pos[1], u.HP)
	}
	// Zart dies -> spirits die, journal
	c.Vars["0|q.gz2mg.qgz2mg5"], c.Vars["0|q.gz2mg.qgz2mg5.1"] = 1, 1
	zt := unit(z, "Zart")
	z.Kill(zt)
	tick(z, 80)
	fe := unit(z, "FireEl2")
	check(c.Var("gz2mg.zart") == 1 && fe.Dead(), "Zart dead → spirits dead (FireEl2 dead=%v)", fe.Dead())
	check(c.Var("q.gz2mg.qgz2mg5.3") == 1 && c.Var("b.bram.c6") == 1, "Q5 journal (q5.3=%v)", c.Var("q.gz2mg.qgz2mg5.3"))
	report(z, "gz2mg end")
	z.Free()
	// ---------- gz3mg ----------
	c.Vars["0|q.gz2mg.qgz2mg7"], c.Vars["0|q.gz2mg.qgz2mg7.1"] = 1, 1
	k, _, err := c.Enter("gz3mg", 1, 12)
	if err != nil {
		fmt.Println("gz3mg:", err)
		os.Exit(1)
	}
	k.VM.Log = func(f string, a ...any) { fmt.Printf("    [gz3mg vm] "+f+"\n", a...) }
	tick(k, 40)
	report(k, "gz3mg")
	for _, n := range []string{"OldTroll", "YoungTroll1", "YoungTroll2", "PanzerQueen"} {
		if u := unit(k, n); u != nil {
			k.Kill(u)
		}
	}
	tick(k, 60)
	check(c.Var("gz3mg.trolls") == 1 && c.Var("q.gz2mg.qgz2mg7.2") == 1, "Q7 trolls (q7.2=%v)", c.Var("q.gz2mg.qgz2mg7.2"))
	check(c.Var("gz2mg.queen") == 1, "queen flag")
	var keys []string
	for k := range c.Vars {
		if strings.Contains(k, "gz2mg") || strings.Contains(k, "gz3mg") {
			keys = append(keys, k)
		}
	}
	sort.Strings(keys)
	fmt.Println("vars:", keys)
	_ = math.Pi
}
