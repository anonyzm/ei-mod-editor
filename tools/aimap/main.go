// aimap: game.exe's passability for the editor, computed by New EI's port (package ei, read only).
// Builds the fine AI grid (0.5 m cells, 8 classes) of a landscape with the objects of a MOB and,
// with -graph, the node graph costs the game's builder would give (0x5AFAE0 + 0x5B0F70).
//
//	aimap -game <game dir> -in <file> -out <file> [-graph]
//
// in: u32 mprLen, mpr bytes, mob bytes (the editor's current, maybe unsaved, state).
// out: u32 W, u32 H (cells), W*H u32 class nibbles (4 bits per class, 0 = closed), W*H u8 terrain type,
// then u32 gW, u32 gH and 8 layers of gW*gH*8 u16 edge costs (gW = gH = 0 without -graph or graph).
package main

import (
	"bytes"
	"encoding/binary"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"newei/ei"
)

func main() {
	game := flag.String("game", "", "game folder")
	in := flag.String("in", "", "input file")
	out := flag.String("out", "", "output file")
	graph := flag.Bool("graph", false, "also rebuild the node graph costs")
	flag.Parse()
	if err := run(*game, *in, *out, *graph); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(game, in, out string, graph bool) error {
	b, err := os.ReadFile(in)
	if err != nil {
		return err
	}
	if len(b) < 4 || int(binary.LittleEndian.Uint32(b)) > len(b)-4 {
		return fmt.Errorf("вход обрезан")
	}
	n := int(binary.LittleEndian.Uint32(b))
	terrain, err := ei.ParseMPR(b[4 : 4+n])
	if err != nil {
		return err
	}
	chunks, err := ei.ParseMOB(b[4+n:])
	if err != nil {
		return err
	}
	res := func(name string) (*ei.Res, error) { return ei.OpenRes(filepath.Join(game, "Res", name)) }
	ai, err := res("aiinfo.res")
	if err != nil {
		return err
	}
	tb, err := ai.Read("tileDesc.reg")
	if err != nil {
		return err
	}
	descs, err := ei.ParseTileDescs(tb)
	if err != nil {
		return err
	}
	if len(descs) == 15 { // the editor writes this section into tileDesc.reg on save (src/shared/passability.js)
		descs = append(descs, ei.TileDesc{Name: "BLOCK", CostMul: 100, Speed: 1024, StepLook: 100, StepSmell: 100, StepSound: 100})
	}
	m := ei.NewAIMap(terrain)
	if err := stamp(m, chunks, res); err != nil {
		return err
	}
	m.Update(descs)

	var w bytes.Buffer
	put := func(v any) { binary.Write(&w, binary.LittleEndian, v) }
	put([2]uint32{uint32(m.W), uint32(m.H)})
	put(m.Nibble)
	put(m.Type)
	g, _ := ei.AIGraphOf(chunks)
	if !graph || g == nil {
		put([2]uint32{0, 0})
	} else {
		put([2]uint32{uint32(g.W), uint32(g.H)})
		costs := ei.BuildGraphCosts(m, g)
		for _, c := range costs {
			put(c)
		}
	}
	return os.WriteFile(out, w.Bytes(), 0o644)
}

// stamp puts every placed object except creatures into the grid, as engine/path.go buildAIMap does.
func stamp(m *ei.AIMap, chunks []*ei.Chunk, res func(string) (*ei.Res, error)) error {
	figs, err := res("figures.res")
	if err != nil {
		return err
	}
	read := func(n string) []byte {
		if !figs.Has(n) {
			return nil
		}
		b, _ := figs.Read(n)
		return b
	}
	models := map[string]*ei.Model{}
	for _, o := range ei.Objects(chunks) {
		if o.Kind == ei.KindUnit || o.Model == "" || o.Hidden {
			continue
		}
		key := strings.ToLower(o.Model)
		md, seen := models[key]
		if !seen {
			if mod := read(key + ".mod"); mod != nil {
				md, _ = ei.ParseModel(mod, read(key+".bon"), key)
			} else if lnk := read(key + ".lnk"); lnk != nil {
				md, _ = ei.ParseLnkModel(lnk, key, read)
			}
			models[key] = md
		}
		if md != nil {
			m.StampObject(ei.AIPartsOf(md, o.Complection, o.BodyParts), o.Rot, o.Pos)
		}
	}
	return nil
}
